import type { ApiErrorDetails, ApiWarning, DeploymentSummary, DeploymentsResponse, ProjectDeployment } from "../../shared/types";
import {
  calculateSummary,
  normalizeDeployment,
  normalizeProject,
  normalizeWorker,
  normalizeWorkerBuild,
  sortProjects,
  workerProductionBranch,
  type CloudflareDeployment,
  type CloudflareProject,
  type CloudflareWorkerBuild,
  type CloudflareWorkerDomain,
  type CloudflareWorkerScript,
} from "../../shared/normalize";
import {
  classifyApiError,
  CloudflareApiError,
  DEFAULT_DEPLOYMENT_PAGE_SIZE,
  DEFAULT_PROJECT_PAGE_SIZE,
  fetchAllPages,
  mapWithConcurrency,
  requestCloudflareJson,
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

type ProjectEntry =
  | { kind: "pages"; name: string; sortHint: number; project: CloudflareProject }
  | { kind: "worker"; name: string; sortHint: number; script: CloudflareWorkerScript };

const parseTime = (value: unknown): number => {
  if (typeof value !== "string") return 0;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? 0 : parsed;
};

// Workers are listed by the scripts API; a failure there (for example a token without Workers
// permissions) becomes a warning so the Pages projects stay visible.
async function listWorkerScripts(accountPath: string, token: string, options: CollectionOptions): Promise<{ scripts: CloudflareWorkerScript[]; warning?: ApiWarning }> {
  const endpoint = `${accountPath}/workers/scripts`;
  try {
    return { scripts: await requestCloudflareJson<CloudflareWorkerScript[]>(endpoint, token, { ...options, operation: "list_worker_scripts" }) };
  } catch (error) {
    const warning = classifyApiError(error, undefined, { requestId: options.requestId, operation: "list_worker_scripts", endpoint });
    warning.message = `Workers could not be listed: ${warning.message}`;
    (options.logger ?? defaultRequestLogger)("worker_scripts_error", { ...warning.details, code: warning.code, message: warning.message });
    return { scripts: [], warning };
  }
}

async function listWorkerDomains(accountPath: string, token: string, options: CollectionOptions): Promise<CloudflareWorkerDomain[]> {
  try {
    return await requestCloudflareJson<CloudflareWorkerDomain[]>(`${accountPath}/workers/domains`, token, { ...options, operation: "list_worker_domains" });
  } catch {
    // Custom domains are decorative; the request logger already recorded the failure.
    return [];
  }
}

export async function collectDeployments(accountId: string, token: string, options: CollectionOptions = {}): Promise<DeploymentsResponse> {
  const accountPath = `/accounts/${encodePathPart(accountId)}`;
  const projectPath = `${accountPath}/pages/projects`;
  const dashboardAccountId = options.accountDashboardId ?? accountId;
  const page = Math.max(1, Math.floor(options.page ?? 1));
  const perPage = options.projectPageSize ?? DEFAULT_PROJECT_PAGE_SIZE;

  // Pages projects and Workers share one paginated list, so both inventories are listed in
  // full (cheap) and deployments are only fetched for the entries on the requested page.
  const [rawProjects, workerListing] = await Promise.all([
    fetchAllPages<CloudflareProject>(projectPath, token, perPage, { ...options, operation: "list_projects" }),
    listWorkerScripts(accountPath, token, options),
  ]);
  const entries: ProjectEntry[] = [
    ...rawProjects.map((project): ProjectEntry => ({ kind: "pages", name: String(project.name ?? ""), sortHint: parseTime(project.latest_deployment?.modified_on ?? project.latest_deployment?.created_on ?? project.created_on), project })),
    ...workerListing.scripts.map((script): ProjectEntry => ({ kind: "worker", name: String(script.id ?? ""), sortHint: parseTime(script.modified_on ?? script.created_on), script })),
  ].sort((left, right) => (right.sortHint - left.sortHint) || left.name.localeCompare(right.name));

  const totalProjects = entries.length;
  const totalPages = Math.max(1, Math.ceil(totalProjects / perPage));
  const pageEntries = entries.slice((page - 1) * perPage, page * perPage);
  const workerDomains = pageEntries.some((entry) => entry.kind === "worker") ? await listWorkerDomains(accountPath, token, options) : [];

  const projectResults = await mapWithConcurrency(pageEntries, options.projectConcurrency ?? 6, (entry) =>
    entry.kind === "pages"
      ? collectPagesProject(entry.project, projectPath, accountId, dashboardAccountId, token, options)
      : collectWorker(entry.script, accountPath, dashboardAccountId, workerDomains, token, options));

  const warnings = [...(workerListing.warning ? [workerListing.warning] : []), ...projectResults.flatMap((project) => (project.error ? [project.error] : []))];
  return {
    fetchedAt: new Date().toISOString(),
    projects: sortProjects(projectResults),
    summary: { ...calculateSummary(projectResults), totalProjects },
    pagination: { page, perPage, totalProjects, totalPages },
    warnings,
  };
}

async function collectPagesProject(rawProject: CloudflareProject, projectPath: string, accountId: string, dashboardAccountId: string, token: string, options: CollectionOptions): Promise<ProjectDeployment> {
  const project = normalizeProject(rawProject, dashboardAccountId);
  const deploymentPath = `${projectPath}/${encodePathPart(project.projectName)}/deployments?page=1&per_page=${options.deploymentPageSize ?? DEFAULT_DEPLOYMENT_PAGE_SIZE}`;
  try {
    const rawDeployments = await requestCloudflareJson<CloudflareDeployment[]>(deploymentPath, token, { ...options, operation: "list_project_deployments", projectName: project.projectName });
    const deployments = rawDeployments
      .map((deployment) => normalizeDeployment(deployment, accountId, project.projectName))
      .sort((left, right) => deploymentTimestamp(right) - deploymentTimestamp(left));
    return { ...project, deployments };
  } catch (error) {
    const warning = classifyApiError(error, project.projectName, { requestId: options.requestId, operation: "list_project_deployments", endpoint: deploymentPath });
    (options.logger ?? defaultRequestLogger)("project_deployments_error", { ...warning.details, code: warning.code, message: warning.message });
    return { ...project, deployments: [], error: warning };
  }
}

async function collectWorker(script: CloudflareWorkerScript, accountPath: string, dashboardAccountId: string, domains: CloudflareWorkerDomain[], token: string, options: CollectionOptions): Promise<ProjectDeployment> {
  const worker = normalizeWorker(script, dashboardAccountId, domains);
  if (!worker.projectId) return { ...worker, deployments: [] };
  const buildsPath = `${accountPath}/builds/workers/${encodePathPart(worker.projectId)}/builds?page=1&per_page=${options.deploymentPageSize ?? DEFAULT_DEPLOYMENT_PAGE_SIZE}`;
  try {
    const rawBuilds = await requestCloudflareJson<CloudflareWorkerBuild[]>(buildsPath, token, { ...options, operation: "list_worker_builds", projectName: worker.projectName });
    const deployments = rawBuilds
      .map((build) => normalizeWorkerBuild(build, dashboardAccountId, worker.projectName))
      .sort((left, right) => deploymentTimestamp(right) - deploymentTimestamp(left));
    return { ...worker, productionBranch: workerProductionBranch(rawBuilds), deployments };
  } catch (error) {
    // A Worker that is not connected to Workers Builds has no build history; that is not an error.
    if (error instanceof CloudflareApiError && error.status === 404) return { ...worker, deployments: [] };
    const warning = classifyApiError(error, worker.projectName, { requestId: options.requestId, operation: "list_worker_builds", endpoint: buildsPath });
    (options.logger ?? defaultRequestLogger)("worker_builds_error", { ...warning.details, code: warning.code, message: warning.message });
    return { ...worker, deployments: [], error: warning };
  }
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

const defaultRequestLogger = (event: string, details: ApiErrorDetails & { code?: string; message?: string }) => {
  console.error(`[pages-deploy-tracker] ${event}`, JSON.stringify(details));
};

export const onRequestGet: PagesFunction<TrackerEnv> = async (context) => {
  const requestId = context.request.headers.get("cf-ray") ?? crypto.randomUUID();
  const accountId = context.env.CLOUDFLARE_ACCOUNT_ID?.trim();
  const token = context.env.CLOUDFLARE_API_TOKEN?.trim();
  if (!accountId || !token) {
    const warning: ApiWarning = {
      code: "MISSING_CONFIGURATION",
      message: "The server is missing Cloudflare account configuration.",
      details: { requestId, operation: "validate_configuration", endpoint: "/api/deployments", method: "GET", cause: `CLOUDFLARE_ACCOUNT_ID=${accountId ? "present" : "missing"}; CLOUDFLARE_API_TOKEN=${token ? "present" : "missing"}` },
    };
    defaultRequestLogger("configuration_error", { ...warning.details, code: warning.code, message: warning.message });
    return errorResponse(warning);
  }

  try {
    const requestedPage = Number(new URL(context.request.url).searchParams.get("page") ?? "1");
    const page = Number.isFinite(requestedPage) && requestedPage >= 1 ? Math.floor(requestedPage) : 1;
    const data = await collectDeployments(accountId, token, { page, requestId, logger: defaultRequestLogger });
    return new Response(JSON.stringify(data), { headers: jsonHeaders });
  } catch (error) {
    const warning = classifyApiError(error, undefined, { requestId, operation: "collect_deployments", endpoint: "/api/deployments", method: "GET" });
    if (error instanceof CloudflareApiError && error.status === 401) {
      warning.message = "Cloudflare rejected the API token. Check that it is valid and has Pages Read access (plus Workers Scripts Read and Workers Builds Configuration Read for Workers).";
    } else if (error instanceof CloudflareApiError && error.status === 403) {
      warning.message = "Cloudflare denied access. Check the token scope and target account.";
    } else if (error instanceof CloudflareApiError && error.status === 429) {
      warning.message = "Cloudflare rate-limited the tracker. Try again shortly.";
    }
    defaultRequestLogger("deployment_collection_error", { ...warning.details, code: warning.code, message: warning.message });
    return errorResponse(warning);
  }
};
