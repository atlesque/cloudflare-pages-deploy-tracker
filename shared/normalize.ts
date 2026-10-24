import type {
  DeploymentStatus,
  DeploymentSummary,
  DeploymentsResponse,
  DeploymentsSummary,
  ProjectDeployment,
  StatusFilter,
} from "./types";

export interface CloudflareStage {
  name?: unknown;
  status?: unknown;
  started_on?: unknown;
  ended_on?: unknown;
}

export interface CloudflareDeployment {
  id?: unknown;
  short_id?: unknown;
  project_name?: unknown;
  environment?: unknown;
  latest_stage?: CloudflareStage | null;
  created_on?: unknown;
  modified_on?: unknown;
  deployment_trigger?: {
    metadata?: {
      branch?: unknown;
      commit_hash?: unknown;
      commit_message?: unknown;
    } | null;
  } | null;
  url?: unknown;
  aliases?: unknown;
}

export interface CloudflareProject {
  id?: unknown;
  name?: unknown;
  production_branch?: unknown;
  subdomain?: unknown;
  domains?: unknown;
  created_on?: unknown;
  latest_deployment?: { modified_on?: unknown; created_on?: unknown } | null;
}

export interface CloudflareWorkerScript {
  id?: unknown;
  tag?: unknown;
  created_on?: unknown;
  modified_on?: unknown;
}

export interface CloudflareWorkerBuild {
  build_uuid?: unknown;
  status?: unknown;
  build_outcome?: unknown;
  created_on?: unknown;
  initializing_on?: unknown;
  running_on?: unknown;
  stopped_on?: unknown;
  modified_on?: unknown;
  preview_url?: unknown;
  build_trigger_metadata?: {
    branch?: unknown;
    commit_hash?: unknown;
    commit_message?: unknown;
    build_trigger_source?: unknown;
  } | null;
  trigger?: {
    branch_includes?: unknown;
  } | null;
}

export interface CloudflareWorkerDomain {
  hostname?: unknown;
  service?: unknown;
}

const asString = (value: unknown): string | undefined =>
  typeof value === "string" && value.trim() ? value : undefined;

const asStringArray = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.length > 0) : [];

export function mapDeploymentStatus(stage: CloudflareStage | null | undefined): DeploymentStatus {
  const stageName = asString(stage?.name);
  const status = asString(stage?.status);

  if (status === "active") return "active";
  if (stageName === "queued") return "queued";
  if (status === "success" || status === "failure" || status === "canceled") return status;
  if (status === "idle") return stage?.ended_on ? "success" : "unknown";
  return "unknown";
}

export function normalizeDeployment(
  deployment: CloudflareDeployment,
  accountId: string,
  projectNameFallback?: string,
): DeploymentSummary {
  const projectName = asString(deployment.project_name) ?? projectNameFallback ?? "Unknown project";
  const id = asString(deployment.id) ?? `${projectName}-${asString(deployment.modified_on) ?? "deployment"}`;
  const stage = asString(deployment.latest_stage?.name) ?? "unknown";
  const environmentValue = asString(deployment.environment);
  const environment = environmentValue === "production" || environmentValue === "preview" ? environmentValue : "unknown";
  const aliases = asStringArray(deployment.aliases);

  return {
    id,
    shortId: asString(deployment.short_id),
    projectName,
    environment,
    status: mapDeploymentStatus(deployment.latest_stage),
    stage,
    stageStartedAt: asString(deployment.latest_stage?.started_on),
    stageEndedAt: asString(deployment.latest_stage?.ended_on),
    createdAt: asString(deployment.created_on),
    modifiedAt: asString(deployment.modified_on),
    branch: asString(deployment.deployment_trigger?.metadata?.branch),
    commitHash: asString(deployment.deployment_trigger?.metadata?.commit_hash),
    commitMessage: asString(deployment.deployment_trigger?.metadata?.commit_message),
    url: asString(deployment.url) ?? aliases[0],
    aliases,
    dashboardUrl: `https://dash.cloudflare.com/${encodeURIComponent(accountId)}/pages/view/${encodeURIComponent(projectName)}`,
  };
}

export function normalizeProject(project: CloudflareProject, accountId: string): Omit<ProjectDeployment, "deployments"> {
  const projectName = asString(project.name) ?? "Unnamed project";
  const domains = asStringArray(project.domains);
  return {
    projectName,
    projectId: asString(project.id),
    productionBranch: asString(project.production_branch),
    subdomain: asString(project.subdomain),
    domains,
    dashboardUrl: `https://dash.cloudflare.com/${encodeURIComponent(accountId)}/pages/view/${encodeURIComponent(projectName)}`,
  };
}

export function mapWorkerBuildStatus(build: CloudflareWorkerBuild): DeploymentStatus {
  const status = asString(build.status);
  if (status === "queued") return "queued";
  if (status === "initializing" || status === "running") return "active";
  if (status !== "stopped") return "unknown";
  const outcome = asString(build.build_outcome);
  if (outcome === "success") return "success";
  if (outcome === "fail") return "failure";
  if (outcome === "cancelled" || outcome === "terminated" || outcome === "skipped") return "canceled";
  return "unknown";
}

const workerDashboardUrl = (accountId: string, scriptName: string) =>
  `https://dash.cloudflare.com/${encodeURIComponent(accountId)}/workers/services/view/${encodeURIComponent(scriptName)}/production/deployments`;

// Workers Builds has no environment field. A build counts as production when its trigger
// names the branch explicitly (the default "Deploy default branch" trigger includes ["main"]);
// branches matched only by a wildcard trigger upload preview versions instead.
const workerBuildEnvironment = (build: CloudflareWorkerBuild, branch: string | undefined): DeploymentSummary["environment"] => {
  if (asString(build.build_trigger_metadata?.build_trigger_source) === "pull_request") return "preview";
  if (!branch) return "unknown";
  return asStringArray(build.trigger?.branch_includes).includes(branch) ? "production" : "preview";
};

export function normalizeWorkerBuild(build: CloudflareWorkerBuild, accountId: string, scriptName: string): DeploymentSummary {
  const status = mapWorkerBuildStatus(build);
  const createdAt = asString(build.created_on);
  const stoppedAt = asString(build.stopped_on);
  const branch = asString(build.build_trigger_metadata?.branch);
  const previewUrl = asString(build.preview_url);
  return {
    id: asString(build.build_uuid) ?? `${scriptName}-${createdAt ?? "build"}`,
    shortId: asString(build.build_uuid)?.slice(0, 8),
    projectName: scriptName,
    environment: workerBuildEnvironment(build, branch),
    status,
    stage: status === "success" || status === "failure" || status === "canceled" ? (asString(build.build_outcome) ?? "stopped") : (asString(build.status) ?? "unknown"),
    stageStartedAt: asString(build.running_on) ?? asString(build.initializing_on) ?? createdAt,
    stageEndedAt: stoppedAt,
    createdAt,
    modifiedAt: asString(build.modified_on) ?? stoppedAt ?? createdAt,
    branch,
    commitHash: asString(build.build_trigger_metadata?.commit_hash),
    commitMessage: asString(build.build_trigger_metadata?.commit_message),
    url: previewUrl,
    aliases: previewUrl ? [previewUrl] : [],
    dashboardUrl: workerDashboardUrl(accountId, scriptName),
  };
}

export function normalizeWorker(script: CloudflareWorkerScript, accountId: string, domains: CloudflareWorkerDomain[] = []): Omit<ProjectDeployment, "deployments"> {
  const projectName = asString(script.id) ?? "Unnamed Worker";
  return {
    kind: "worker",
    projectName,
    projectId: asString(script.tag),
    domains: domains.filter((domain) => domain.service === projectName).map((domain) => asString(domain.hostname)).filter((hostname): hostname is string => Boolean(hostname)),
    dashboardUrl: workerDashboardUrl(accountId, projectName),
  };
}

/** The branch a Worker deploys to production from, taken from its builds' explicit trigger branches. */
export function workerProductionBranch(builds: CloudflareWorkerBuild[]): string | undefined {
  for (const build of builds) {
    const branch = asStringArray(build.trigger?.branch_includes).find((value) => !value.includes("*"));
    if (branch) return branch;
  }
  return undefined;
}

/** Stable key for routing and React lists, since a Worker and a Pages project can share a name. */
export const projectKey = (project: Pick<ProjectDeployment, "kind" | "projectName">): string =>
  project.kind === "worker" ? `worker:${project.projectName}` : project.projectName;

const statusPriority: Record<DeploymentStatus, number> = {
  active: 0,
  queued: 1,
  failure: 2,
  success: 3,
  canceled: 4,
  unknown: 5,
};

const timestamp = (deployment: DeploymentSummary): number => {
  const value = deployment.modifiedAt ?? deployment.createdAt;
  if (!value) return 0;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? 0 : parsed;
};

export function sortProjects(projects: ProjectDeployment[]): ProjectDeployment[] {
  return [...projects].sort((left, right) => {
    const leftDeployment = left.deployments[0];
    const rightDeployment = right.deployments[0];
    if (!leftDeployment && !rightDeployment) return left.projectName.localeCompare(right.projectName);
    if (!leftDeployment) return 1;
    if (!rightDeployment) return -1;
    return (timestamp(rightDeployment) - timestamp(leftDeployment)) || (statusPriority[leftDeployment.status] - statusPriority[rightDeployment.status]);
  });
}

export function calculateSummary(projects: ProjectDeployment[]): DeploymentsSummary {
  const summary: DeploymentsSummary = {
    totalProjects: projects.length,
    active: 0,
    queued: 0,
    success: 0,
    failure: 0,
    canceled: 0,
  };
  for (const project of projects) {
    const status = project.deployments[0]?.status;
    if (status === "active" || status === "queued" || status === "success" || status === "failure" || status === "canceled") summary[status] += 1;
  }
  return summary;
}

export function filterProjects(projects: ProjectDeployment[], status: StatusFilter, query: string): ProjectDeployment[] {
  const normalizedQuery = query.trim().toLowerCase();
  return projects.filter((project) => {
    const currentStatus = project.deployments[0]?.status;
    const matchesStatus = status === "all" || currentStatus === status;
    const searchable = [project.projectName, project.productionBranch, project.deployments[0]?.branch].filter(Boolean).join(" ").toLowerCase();
    return matchesStatus && (!normalizedQuery || searchable.includes(normalizedQuery));
  });
}

export function emptyResponse(fetchedAt = new Date().toISOString()): DeploymentsResponse {
  return {
    fetchedAt,
    projects: [],
    summary: { totalProjects: 0, active: 0, queued: 0, success: 0, failure: 0, canceled: 0 },
    pagination: { page: 1, perPage: 10, totalProjects: 0, totalPages: 1 },
    warnings: [],
  };
}
