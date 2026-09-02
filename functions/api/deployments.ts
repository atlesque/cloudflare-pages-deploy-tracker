import type { ApiWarning, DeploymentSummary, DeploymentsResponse, ProjectDeployment } from "../../shared/types";
import { calculateSummary, normalizeDeployment, normalizeProject, sortProjects, type CloudflareDeployment, type CloudflareProject } from "../../shared/normalize";
import {
  classifyApiError,
  CloudflareApiError,
  DEFAULT_DEPLOYMENT_PAGE_SIZE,
  DEFAULT_PROJECT_PAGE_SIZE,
  mapWithConcurrency,
  requestCloudflareJson,
  requestCloudflarePage,
  type RequestDependencies,
} from "../lib/cloudflare";

type TrackerEnv = Env & {
  CLOUDFLARE_ACCOUNT_ID?: string;
  CLOUDFLARE_API_TOKEN?: string;
};

interface CollectionOptions extends RequestDependencies {
  projectConcurrency?: number;
  page?: number;
  projectPageSize?: number;
  deploymentPageSize?: number;
  accountDashboardId?: string;
}

const jsonHeaders = { "Content-Type": "application/json", "Cache-Control": "no-store" };

const encodePathPart = (value: string) => encodeURIComponent(value);

const warningStatus = (warning: ApiWarning): number => {
  if (warning.code === "MISSING_CONFIGURATION") return 500;
  if (warning.status === 401 || warning.status === 403) return warning.status;
  if (warning.status === 429) return 429;
  return 502;
};

export async function collectDeployments(accountId: string, token: string, options: CollectionOptions = {}): Promise<DeploymentsResponse> {
  const projectPath = `/accounts/${encodePathPart(accountId)}/pages/projects`;
  const page = Math.max(1, Math.floor(options.page ?? 1));
  const perPage = options.projectPageSize ?? DEFAULT_PROJECT_PAGE_SIZE;
  const projectPage = await requestCloudflarePage<CloudflareProject[]>(`${projectPath}?page=${page}&per_page=${perPage}`, token, options);
  const rawProjects = projectPage.result;
  const projects = rawProjects.map((project) => normalizeProject(project, options.accountDashboardId ?? accountId));
  const projectResults = await mapWithConcurrency(projects, options.projectConcurrency ?? 6, async (project) => {
    try {
      const deploymentPath = `${projectPath}/${encodePathPart(project.projectName)}/deployments?page=1&per_page=${options.deploymentPageSize ?? DEFAULT_DEPLOYMENT_PAGE_SIZE}`;
      const rawDeployments = await requestCloudflareJson<CloudflareDeployment[]>(deploymentPath, token, options);
      const deployments = rawDeployments
        .map((deployment) => normalizeDeployment(deployment, accountId, project.projectName))
        .sort((left, right) => deploymentTimestamp(right) - deploymentTimestamp(left));
      return { ...project, deployments } satisfies ProjectDeployment;
    } catch (error) {
      const warning = classifyApiError(error, project.projectName);
      return { ...project, deployments: [], error: warning } satisfies ProjectDeployment;
    }
  });

  const warnings = projectResults.flatMap((project) => (project.error ? [project.error] : []));
  const totalProjects = projectPage.resultInfo?.total_count ?? projects.length;
  const totalPages = projectPage.resultInfo?.total_pages ?? Math.max(1, Math.ceil(totalProjects / perPage));
  return {
    fetchedAt: new Date().toISOString(),
    projects: sortProjects(projectResults),
    summary: { ...calculateSummary(projectResults), totalProjects },
    pagination: {
      page: projectPage.resultInfo?.page ?? page,
      perPage: projectPage.resultInfo?.per_page ?? perPage,
      totalProjects,
      totalPages,
    },
    warnings,
  };
}

const deploymentTimestamp = (deployment: DeploymentSummary): number => {
  const value = deployment.modifiedAt ?? deployment.createdAt;
  if (!value) return 0;
  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? 0 : timestamp;
};

const errorResponse = (warning: ApiWarning, response?: Partial<DeploymentsResponse>) => {
  const payload = {
    fetchedAt: new Date().toISOString(),
    projects: response?.projects ?? [],
    summary: response?.summary ?? calculateSummary(response?.projects ?? []),
    warnings: response?.warnings ?? [],
    error: warning,
  };
  return new Response(JSON.stringify(payload), { status: warningStatus(warning), headers: jsonHeaders });
};

export const onRequestGet: PagesFunction<TrackerEnv> = async (context) => {
  const accountId = context.env.CLOUDFLARE_ACCOUNT_ID?.trim();
  const token = context.env.CLOUDFLARE_API_TOKEN?.trim();
  if (!accountId || !token) {
    return errorResponse({ code: "MISSING_CONFIGURATION", message: "The server is missing Cloudflare account configuration." });
  }

  try {
    const requestedPage = Number(new URL(context.request.url).searchParams.get("page") ?? "1");
    const page = Number.isFinite(requestedPage) && requestedPage >= 1 ? Math.floor(requestedPage) : 1;
    const data = await collectDeployments(accountId, token, { page });
    return new Response(JSON.stringify(data), { headers: jsonHeaders });
  } catch (error) {
    const warning = classifyApiError(error);
    if (error instanceof CloudflareApiError && error.status === 401) {
      warning.message = "Cloudflare rejected the API token. Check that it is valid and has Pages Read access.";
    } else if (error instanceof CloudflareApiError && error.status === 403) {
      warning.message = "Cloudflare denied access. Check the token scope and target account.";
    } else if (error instanceof CloudflareApiError && error.status === 429) {
      warning.message = "Cloudflare rate-limited the tracker. Try again shortly.";
    }
    return errorResponse(warning);
  }
};
