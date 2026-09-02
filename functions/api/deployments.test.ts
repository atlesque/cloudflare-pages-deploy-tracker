import { describe, expect, it, vi } from "vitest";
import { collectDeployments } from "./deployments";

const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

describe("deployment collection", () => {
  it("keeps successful projects visible when one deployment request fails", async () => {
    const fetcher = vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/pages/projects?page=2&per_page=10")) {
        return Promise.resolve(response({ result: [{ id: "1", name: "healthy" }, { id: "2", name: "unavailable" }], success: true, result_info: { page: 2, per_page: 10, total_count: 39, total_pages: 4 } }));
      }
      if (url.includes("/healthy/deployments")) {
        return Promise.resolve(response({ result: [{ id: "deployment-1", project_name: "healthy", environment: "production", modified_on: "2026-09-02T10:00:00Z", latest_stage: { name: "deploy", status: "success", ended_on: "2026-09-02T10:00:00Z" } }], success: true }));
      }
      return Promise.resolve(response({ errors: [{ message: "project unavailable" }], success: false }, 404));
    });

    const result = await collectDeployments("account-id", "secret-token", { fetcher, page: 2, sleep: vi.fn().mockResolvedValue(undefined) });

    expect(result.projects.map((project) => project.projectName)).toEqual(["healthy", "unavailable"]);
    expect(result.projects[0].deployments[0].status).toBe("success");
    expect(result.projects[1].error).toMatchObject({ projectName: "unavailable", status: 404 });
    expect(result.warnings).toHaveLength(1);
    expect(result.pagination).toEqual({ page: 2, perPage: 10, totalProjects: 39, totalPages: 4 });
    expect(result.summary.totalProjects).toBe(39);
    expect(fetcher.mock.calls.some(([input]) => String(input).includes("/unavailable/deployments"))).toBe(true);
    expect(JSON.stringify(result)).not.toContain("secret-token");
  });
});
