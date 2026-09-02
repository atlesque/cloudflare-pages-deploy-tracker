import type { ApiWarning } from "../../shared/types";

export const CLOUDFLARE_API_BASE = "https://api.cloudflare.com/client/v4";
export const DEFAULT_TIMEOUT_MS = 10_000;
export const DEFAULT_MAX_ATTEMPTS = 3;
export const DEFAULT_PROJECT_PAGE_SIZE = 10;
export const DEFAULT_DEPLOYMENT_PAGE_SIZE = 20;

export class CloudflareApiError extends Error {
  readonly status?: number;
  readonly code: string;
  readonly retryable: boolean;

  constructor(message: string, options: { status?: number; code?: string; retryable?: boolean } = {}) {
    super(message);
    this.name = "CloudflareApiError";
    this.status = options.status;
    this.code = options.code ?? "CLOUDFLARE_API_ERROR";
    this.retryable = options.retryable ?? false;
  }
}

export interface RequestDependencies {
  fetcher?: typeof fetch;
  sleep?: (milliseconds: number) => Promise<void>;
}

interface RequestOptions extends RequestDependencies {
  timeoutMs?: number;
  maxAttempts?: number;
}

interface CloudflareEnvelope<T> {
  success?: boolean;
  result?: T;
  errors?: Array<{ code?: number; message?: string }>;
  result_info?: { page?: number; per_page?: number; total_count?: number; total_pages?: number };
}

export interface CloudflarePageInfo {
  page?: number;
  per_page?: number;
  total_count?: number;
  total_pages?: number;
}

const defaultSleep = (milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

const isRetryableStatus = (status: number) => status === 429 || status >= 500;

const errorMessage = (body: unknown, fallback: string): string => {
  if (!body || typeof body !== "object") return fallback;
  const errors = (body as CloudflareEnvelope<unknown>).errors;
  const message = errors?.find((error) => typeof error.message === "string")?.message;
  return message ?? fallback;
};

const retryAfterMilliseconds = (response: Response, attempt: number): number => {
  const retryAfter = response.headers.get("Retry-After");
  const retryAfterSeconds = retryAfter ? Number(retryAfter) : Number.NaN;
  if (Number.isFinite(retryAfterSeconds) && retryAfterSeconds >= 0) return Math.min(2_000, retryAfterSeconds * 1_000);
  return Math.min(2_000, 250 * 2 ** attempt);
};

async function requestCloudflareEnvelope<T>(path: string, token: string, options: RequestOptions = {}): Promise<CloudflareEnvelope<T>> {
  const fetcher = options.fetcher ?? fetch;
  const sleep = options.sleep ?? defaultSleep;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    let response: Response;
    try {
      response = await fetcher(`${CLOUDFLARE_API_BASE}${path}`, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/json",
        },
        signal: controller.signal,
      });
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        throw new CloudflareApiError("Cloudflare API request timed out.", { code: "CLOUDFLARE_TIMEOUT", retryable: true });
      }
      throw new CloudflareApiError("Cloudflare API request could not be completed.", { code: "CLOUDFLARE_NETWORK_ERROR", retryable: true });
    } finally {
      clearTimeout(timeout);
    }

    let body: unknown;
    try {
      body = await response.json();
    } catch {
      body = undefined;
    }

    if (response.ok) {
      const envelope = body as CloudflareEnvelope<T>;
      if (envelope.success === false || envelope.result === undefined) {
        throw new CloudflareApiError(errorMessage(body, "Cloudflare returned an invalid response."), { code: "CLOUDFLARE_INVALID_RESPONSE" });
      }
      return envelope;
    }

    const retryable = isRetryableStatus(response.status);
    if (retryable && attempt < maxAttempts - 1) {
      await sleep(retryAfterMilliseconds(response, attempt));
      continue;
    }

    const code = response.status === 401 || response.status === 403 ? "CLOUDFLARE_AUTHENTICATION_ERROR" : response.status === 429 ? "CLOUDFLARE_RATE_LIMITED" : `CLOUDFLARE_HTTP_${response.status}`;
    throw new CloudflareApiError(errorMessage(body, `Cloudflare returned HTTP ${response.status}.`), {
      status: response.status,
      code,
      retryable,
    });
  }

  throw new CloudflareApiError("Cloudflare API request failed after retries.", { code: "CLOUDFLARE_RETRY_EXHAUSTED", retryable: true });
}

export async function requestCloudflareJson<T>(path: string, token: string, options: RequestOptions = {}): Promise<T> {
  const envelope = await requestCloudflareEnvelope<T>(path, token, options);
  return envelope.result as T;
}

export async function requestCloudflarePage<T>(path: string, token: string, options: RequestOptions = {}): Promise<{ result: T; resultInfo?: CloudflarePageInfo }> {
  const envelope = await requestCloudflareEnvelope<T>(path, token, options);
  return { result: envelope.result as T, resultInfo: envelope.result_info };
}

export async function fetchAllPages<T>(
  path: string,
  token: string,
  perPage: number,
  dependencies: RequestDependencies = {},
): Promise<T[]> {
  const results: T[] = [];
  let page = 1;
  let totalPages: number | undefined;

  while (page <= (totalPages ?? 1_000)) {
    const separator = path.includes("?") ? "&" : "?";
    const response = await requestCloudflareEnvelope<T[]>(
      `${path}${separator}page=${page}&per_page=${perPage}`,
      token,
      dependencies,
    );
    const pageResults = response.result ?? [];
    const pageInfo = response.result_info;
    results.push(...pageResults);
    totalPages = pageInfo?.total_pages ?? totalPages;
    if (pageResults.length === 0 || (totalPages !== undefined && page >= totalPages) || pageResults.length < perPage) break;
    page += 1;
  }

  return results;
}

export async function mapWithConcurrency<T, R>(items: T[], limit: number, mapper: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let nextIndex = 0;
  const worker = async (): Promise<void> => {
    while (true) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= items.length) return;
      results[index] = await mapper(items[index]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(Math.max(1, limit), items.length || 1) }, () => worker()));
  return results;
}

export function classifyApiError(error: unknown, projectName?: string): ApiWarning {
  if (error instanceof CloudflareApiError) {
    return { code: error.code, message: error.message, projectName, status: error.status };
  }
  return { code: "UNEXPECTED_ERROR", message: "An unexpected error occurred while contacting Cloudflare.", projectName };
}
