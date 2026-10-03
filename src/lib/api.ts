import { sortProjects } from "../../shared/normalize";
import type { ApiWarning, DeploymentsResponse } from "../../shared/types";

export type LoadState =
  | { status: "idle"; previous?: DeploymentsResponse }
  | { status: "loading"; previous?: DeploymentsResponse }
  | { status: "success"; data: DeploymentsResponse }
  | { status: "error"; message: string; previous?: DeploymentsResponse };

interface ErrorPayload {
  error?: ApiWarning;
}

const diagnosticMessage = (warning: ApiWarning | undefined, fallback: string): string => {
  if (!warning) return fallback;
  const details = warning.details ? `\n\nDiagnostics:\n${JSON.stringify(warning.details, null, 2)}` : "";
  return `${warning.message} [${warning.code}]${warning.status ? ` HTTP ${warning.status}` : ""}${details}`;
};

const responsePreview = (body: string): string => {
  const trimmed = body.trim();
  if (!trimmed) return "<empty response>";
  return trimmed.length > 1_000 ? `${trimmed.slice(0, 1_000)}…` : trimmed;
};

export const mergeProjectData = (previous: DeploymentsResponse, next: DeploymentsResponse): DeploymentsResponse => ({
  ...next,
  projects: sortProjects(next.projects.map((refreshedProject) => {
    const previousProject = previous.projects.find((project) => project.projectName === refreshedProject.projectName);
    return previousProject ? { ...previousProject, domains: refreshedProject.domains, deployments: refreshedProject.deployments, error: refreshedProject.error } : refreshedProject;
  })),
});

export async function getDeployments(signal: AbortSignal, page: number): Promise<DeploymentsResponse> {
  const requestUrl = `/api/deployments?page=${page}`;
  let response: Response;
  try {
    response = await fetch(requestUrl, { signal, cache: "no-store" });
  } catch (error) {
    const cause = error instanceof Error ? error.message : String(error);
    throw new Error(`Deployment API request failed. GET ${requestUrl}. Cause: ${cause}. For local development, use the full Pages server with \`pnpm build\` then \`pnpm pages:dev\`; Vite alone does not run the Pages Function.`);
  }
  const contentType = response.headers.get("content-type") ?? "<missing>";
  const responseText = await response.text();
  let body: DeploymentsResponse & ErrorPayload;
  try {
    body = JSON.parse(responseText) as DeploymentsResponse & ErrorPayload;
  } catch {
    throw new Error(`Deployment API returned a non-JSON response. GET ${requestUrl}. HTTP ${response.status} ${response.statusText || "(no status text)"}. Content-Type: ${contentType}. Response preview: ${responsePreview(responseText)}`);
  }
  if (!response.ok) throw new Error(diagnosticMessage(body.error, `Deployment API returned HTTP ${response.status} ${response.statusText || "(no status text)"}. Content-Type: ${contentType}. Response preview: ${responsePreview(responseText)}`));
  return body;
}
