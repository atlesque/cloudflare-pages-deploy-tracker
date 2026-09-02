import { describe, expect, it, vi } from "vitest";
import { fetchAllPages, mapWithConcurrency, requestCloudflareJson } from "./cloudflare";

const response = (body: unknown, status = 200, headers?: HeadersInit) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...headers } });

describe("Cloudflare API client", () => {
  it("follows result_info pagination", async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(response({ result: [{ name: "one" }], success: true, result_info: { total_pages: 2 } }))
      .mockResolvedValueOnce(response({ result: [{ name: "two" }], success: true, result_info: { total_pages: 2 } }));
    const result = await fetchAllPages<{ name: string }>("/accounts/account/pages/projects", "secret-token", 1, { fetcher });
    expect(result).toEqual([{ name: "one" }, { name: "two" }]);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher.mock.calls[1][0]).toContain("page=2&per_page=1");
  });

  it("retries 429 responses and never returns the Authorization header", async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(response({ errors: [{ message: "slow down" }] }, 429)).mockResolvedValueOnce(response({ result: { ok: true }, success: true }));
    const sleep = vi.fn().mockResolvedValue(undefined);
    const result = await requestCloudflareJson<{ ok: boolean }>("/accounts/account/pages/projects", "secret-token", { fetcher, sleep });
    expect(result).toEqual({ ok: true });
    expect(sleep).toHaveBeenCalledOnce();
    expect(JSON.stringify(result)).not.toContain("secret-token");
  });

  it("retries a transient server error", async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(response({ errors: [{ message: "temporary outage" }] }, 503)).mockResolvedValueOnce(response({ result: { ok: true }, success: true }));
    const sleep = vi.fn().mockResolvedValue(undefined);
    await expect(requestCloudflareJson<{ ok: boolean }>("/accounts/account/pages/projects", "secret-token", { fetcher, sleep })).resolves.toEqual({ ok: true });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("does not retry authentication failures", async () => {
    const fetcher = vi.fn().mockResolvedValue(response({ errors: [{ message: "unauthorized" }] }, 401));
    await expect(requestCloudflareJson("/accounts/account/pages/projects", "secret-token", { fetcher, sleep: vi.fn() })).rejects.toMatchObject({ status: 401, retryable: false });
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it("keeps concurrent project work bounded", async () => {
    let active = 0;
    let peak = 0;
    const result = await mapWithConcurrency([1, 2, 3, 4, 5], 2, async (item) => {
      active += 1;
      peak = Math.max(peak, active);
      await Promise.resolve();
      active -= 1;
      return item * 2;
    });
    expect(result).toEqual([2, 4, 6, 8, 10]);
    expect(peak).toBeLessThanOrEqual(2);
  });
});
