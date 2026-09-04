export type DeploymentStatus = "active" | "queued" | "success" | "failure" | "canceled" | "unknown";

export type DeploymentEnvironment = "production" | "preview" | "unknown";

export interface ApiWarning {
  code: string;
  message: string;
  projectName?: string;
  status?: number;
  details?: ApiErrorDetails;
}

export interface ApiErrorDetails {
  requestId?: string;
  operation?: string;
  endpoint?: string;
  method?: string;
  projectName?: string;
  status?: number;
  attempt?: number;
  maxAttempts?: number;
  retryable?: boolean;
  elapsedMs?: number;
  nextRetryMs?: number;
  responseContentType?: string;
  responseBody?: string;
  cfRay?: string;
  retryAfter?: string;
  cause?: string;
}

export interface DeploymentSummary {
  id: string;
  shortId?: string;
  projectName: string;
  environment: DeploymentEnvironment;
  status: DeploymentStatus;
  stage: string;
  stageStartedAt?: string;
  stageEndedAt?: string;
  createdAt?: string;
  modifiedAt?: string;
  branch?: string;
  commitHash?: string;
  commitMessage?: string;
  url?: string;
  aliases: string[];
  dashboardUrl?: string;
}

export interface ProjectDeployment {
  projectName: string;
  projectId?: string;
  productionBranch?: string;
  subdomain?: string;
  domains: string[];
  dashboardUrl?: string;
  deployments: DeploymentSummary[];
  error?: ApiWarning;
}

export interface DeploymentsSummary {
  totalProjects: number;
  active: number;
  queued: number;
  success: number;
  failure: number;
  canceled: number;
}

export interface DeploymentsPagination {
  page: number;
  perPage: number;
  totalProjects: number;
  totalPages: number;
}

export interface DeploymentsResponse {
  fetchedAt: string;
  projects: ProjectDeployment[];
  summary: DeploymentsSummary;
  pagination: DeploymentsPagination;
  warnings: ApiWarning[];
}

export type StatusFilter = "all" | DeploymentStatus;
