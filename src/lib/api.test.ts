import { afterEach, describe, expect, it, vi } from "vitest";
import { getDeployments, prefetchDeployments } from "./api";

const body = { fetchedAt: "2026-10-24T00:00:00.000Z", projects: [], summary: { totalProjects: 0, active: 0, queued: 0, success: 0, failure: 0, canceled: 0 }, pagination: { page: 1, perPage: 10, totalProjects: 0, totalPages: 1 }, warnings: [] };

describe("deployment API client", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("reuses the prefetched first request instead of sending another", async () => {
    const fetcher = vi.fn().mockImplementation(() => Promise.resolve(new Response(JSON.stringify(body), { status: 200 })));
    vi.stubGlobal("fetch", fetcher);
    prefetchDeployments(2);
    await expect(getDeployments(new AbortController().signal, 2)).resolves.toEqual(body);
    expect(fetcher).toHaveBeenCalledOnce();
    await getDeployments(new AbortController().signal, 2);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("ignores a prefetch for a different page", async () => {
    const fetcher = vi.fn().mockImplementation(() => Promise.resolve(new Response(JSON.stringify(body), { status: 200 })));
    vi.stubGlobal("fetch", fetcher);
    prefetchDeployments(1);
    await getDeployments(new AbortController().signal, 3);
    expect(fetcher.mock.calls.map(([url]) => url)).toEqual(["/api/deployments?page=1", "/api/deployments?page=3"]);
  });
});
