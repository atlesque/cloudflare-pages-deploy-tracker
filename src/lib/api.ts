import { projectKey, sortProjects } from "../../shared/normalize";
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
    const previousProject = previous.projects.find((project) => projectKey(project) === projectKey(refreshedProject));
    return previousProject ? { ...previousProject, domains: refreshedProject.domains, productionBranch: refreshedProject.productionBranch, deployments: refreshedProject.deployments, error: refreshedProject.error } : refreshedProject;
  })),
});

const CACHE_STORAGE_KEY_PREFIX = "pages-deploy-tracker-deployments-page-";
const CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1_000;

// The last successful response per page is kept in localStorage so a repeat visit can render it
// immediately while the fresh request is still in flight.
export const readCachedDeployments = (page: number): DeploymentsResponse | undefined => {
  try {
    const saved = window.localStorage.getItem(`${CACHE_STORAGE_KEY_PREFIX}${page}`);
    if (!saved) return undefined;
    const data = JSON.parse(saved) as DeploymentsResponse;
    if (!Array.isArray(data?.projects) || !data.pagination || !data.summary) return undefined;
    if (!(Date.now() - Date.parse(data.fetchedAt) < CACHE_MAX_AGE_MS)) return undefined;
    return data;
  } catch {
    return undefined;
  }
};

export const writeCachedDeployments = (page: number, data: DeploymentsResponse): void => {
  try {
    window.localStorage.setItem(`${CACHE_STORAGE_KEY_PREFIX}${page}`, JSON.stringify(data));
  } catch {
    // Storage may be unavailable or full; the cache is only a first-paint optimisation.
  }
};

let prefetched: { page: number; response: Promise<DeploymentsResponse> } | null = null;

// Starts the first API request before React mounts so it overlaps with loading the app bundle.
export function prefetchDeployments(page: number): void {
  const response = requestDeployments(page);
  response.catch(() => undefined);
  prefetched = { page, response };
}

const abortable = <T>(promise: Promise<T>, signal: AbortSignal): Promise<T> => {
  if (signal.aborted) return Promise.reject(new DOMException("The request was aborted.", "AbortError"));
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(new DOMException("The request was aborted.", "AbortError"));
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener("abort", onAbort));
  });
};

export async function getDeployments(signal: AbortSignal, page: number): Promise<DeploymentsResponse> {
  const pending = prefetched;
  prefetched = null;
  if (pending?.page === page) return abortable(pending.response, signal);
  return requestDeployments(page, signal);
}

async function requestDeployments(page: number, signal?: AbortSignal): Promise<DeploymentsResponse> {
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
