import { describe, expect, it, vi } from "vitest";
import { collectDeployments } from "./deployments";

const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const pagesProject = (name: string, modifiedOn: string) => ({ id: name, name, latest_deployment: { modified_on: modifiedOn } });

describe("deployment collection", () => {
  it("keeps successful projects visible when one deployment request fails", async () => {
    const fetcher = vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/pages/projects?page=1&per_page=10")) {
        return Promise.resolve(response({ result: [pagesProject("healthy", "2026-09-02T10:00:00Z"), pagesProject("unavailable", "2026-09-01T10:00:00Z")], success: true, result_info: { page: 1, per_page: 10, total_count: 2, total_pages: 1 } }));
      }
      if (url.endsWith("/workers/scripts")) return Promise.resolve(response({ result: [], success: true }));
      if (url.includes("/healthy/deployments")) {
        return Promise.resolve(response({ result: [{ id: "deployment-1", project_name: "healthy", environment: "production", modified_on: "2026-09-02T10:00:00Z", latest_stage: { name: "deploy", status: "success", ended_on: "2026-09-02T10:00:00Z" } }], success: true }));
      }
      return Promise.resolve(response({ errors: [{ message: "project unavailable" }], success: false }, 404));
    });

    const logger = vi.fn();
    const result = await collectDeployments("account-id", "secret-token", { fetcher, sleep: vi.fn().mockResolvedValue(undefined), requestId: "req-2", logger });

    expect(result.projects.map((project) => project.projectName)).toEqual(["healthy", "unavailable"]);
    expect(result.projects[0].deployments[0].status).toBe("success");
    expect(result.projects[1].error).toMatchObject({ projectName: "unavailable", status: 404 });
    expect(result.warnings).toHaveLength(1);
    expect(result.pagination).toEqual({ page: 1, perPage: 10, totalProjects: 2, totalPages: 1 });
    expect(fetcher.mock.calls.some(([input]) => String(input).includes("/unavailable/deployments"))).toBe(true);
    expect(JSON.stringify(result)).not.toContain("secret-token");
    expect(logger).toHaveBeenCalledWith("project_deployments_error", expect.objectContaining({ requestId: "req-2", projectName: "unavailable", status: 404, responseBody: expect.stringContaining("project unavailable") }));
  });

  it("lists Workers with their Workers Builds history alongside Pages projects", async () => {
    const fetcher = vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/pages/projects?")) return Promise.resolve(response({ result: [pagesProject("docs", "2026-10-20T10:00:00Z")], success: true, result_info: { page: 1, per_page: 10, total_count: 1, total_pages: 1 } }));
      if (url.includes("/docs/deployments")) return Promise.resolve(response({ result: [], success: true }));
      if (url.endsWith("/workers/scripts")) {
        return Promise.resolve(response({ result: [{ id: "namesearch", tag: "tag-1", modified_on: "2026-10-24T20:39:00Z" }, { id: "manual-worker", tag: "tag-2", modified_on: "2026-01-01T00:00:00Z" }], success: true }));
      }
      if (url.endsWith("/workers/domains")) return Promise.resolve(response({ result: [{ hostname: "names.example.com", service: "namesearch" }, { hostname: "other.example.com", service: "other" }], success: true }));
      if (url.includes("/builds/workers/tag-1/builds")) {
        return Promise.resolve(response({ success: true, result: [
          { build_uuid: "build-3", status: "running", created_on: "2026-10-24T20:45:00Z", running_on: "2026-10-24T20:45:05Z", build_trigger_metadata: { branch: "feature", commit_hash: "ccc333", build_trigger_source: "push" }, trigger: { branch_includes: ["*"] } },
          { build_uuid: "build-2", status: "stopped", build_outcome: "success", created_on: "2026-10-24T20:38:00Z", stopped_on: "2026-10-24T20:39:00Z", build_trigger_metadata: { branch: "main", commit_hash: "bbb222", commit_message: "Merge pull request #4", build_trigger_source: "push" }, trigger: { branch_includes: ["main"] } },
          { build_uuid: "build-1", status: "stopped", build_outcome: "fail", created_on: "2026-10-24T18:00:00Z", stopped_on: "2026-10-24T18:01:00Z", build_trigger_metadata: { branch: "main", commit_hash: "aaa111" }, trigger: { branch_includes: ["main"] } },
        ] }));
      }
      if (url.includes("/builds/workers/tag-2/builds")) return Promise.resolve(response({ success: false, errors: [{ message: "not found" }] }, 404));
      return Promise.resolve(response({ success: false, errors: [{ message: `unexpected ${url}` }] }, 500));
    });

    const result = await collectDeployments("account-id", "secret-token", { fetcher, sleep: vi.fn().mockResolvedValue(undefined), logger: vi.fn() });

    expect(result.projects.map((project) => [project.kind ?? "pages", project.projectName])).toEqual([["worker", "namesearch"], ["pages", "docs"], ["worker", "manual-worker"]]);
    const namesearch = result.projects[0];
    expect(namesearch).toMatchObject({ projectId: "tag-1", productionBranch: "main", domains: ["names.example.com"] });
    expect(namesearch.deployments.map((build) => [build.id, build.status, build.environment, build.branch, build.commitHash])).toEqual([
      ["build-3", "active", "preview", "feature", "ccc333"],
      ["build-2", "success", "production", "main", "bbb222"],
      ["build-1", "failure", "production", "main", "aaa111"],
    ]);
    expect(namesearch.deployments[1]).toMatchObject({ stage: "success", commitMessage: "Merge pull request #4", stageEndedAt: "2026-10-24T20:39:00Z" });
    expect(result.projects[2]).toMatchObject({ deployments: [] });
    expect(result.projects[2].error).toBeUndefined();
    expect(result.warnings).toHaveLength(0);
    expect(result.pagination).toEqual({ page: 1, perPage: 10, totalProjects: 3, totalPages: 1 });
  });

  it("keeps Pages projects visible when the token cannot list Workers", async () => {
    const fetcher = vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/pages/projects?")) return Promise.resolve(response({ result: [pagesProject("docs", "2026-10-20T10:00:00Z")], success: true, result_info: { total_pages: 1 } }));
      if (url.includes("/docs/deployments")) return Promise.resolve(response({ result: [], success: true }));
      return Promise.resolve(response({ success: false, errors: [{ message: "Authentication error" }] }, 403));
    });

    const result = await collectDeployments("account-id", "secret-token", { fetcher, sleep: vi.fn().mockResolvedValue(undefined), logger: vi.fn() });

    expect(result.projects.map((project) => project.projectName)).toEqual(["docs"]);
    expect(result.warnings).toEqual([expect.objectContaining({ code: "CLOUDFLARE_AUTHENTICATION_ERROR", message: expect.stringContaining("Workers could not be listed") })]);
  });

  it("paginates the combined list and only fetches history for the requested page", async () => {
    const projects = Array.from({ length: 12 }, (_, index) => pagesProject(`site-${String(index).padStart(2, "0")}`, `2026-10-${String(index + 1).padStart(2, "0")}T00:00:00Z`));
    const fetcher = vi.fn((input: RequestInfo | URL) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith("/pages/projects")) {
        const page = Number(url.searchParams.get("page"));
        return Promise.resolve(response({ result: projects.slice((page - 1) * 10, page * 10), success: true, result_info: { page, per_page: 10, total_count: 12, total_pages: 2 } }));
      }
      if (url.pathname.endsWith("/workers/scripts")) return Promise.resolve(response({ result: [], success: true }));
      return Promise.resolve(response({ result: [], success: true }));
    });

    const result = await collectDeployments("account-id", "secret-token", { fetcher, page: 2, logger: vi.fn() });

    expect(result.pagination).toEqual({ page: 2, perPage: 10, totalProjects: 12, totalPages: 2 });
    expect(result.projects.map((project) => project.projectName)).toEqual(["site-00", "site-01"]);
    expect(fetcher.mock.calls.filter(([input]) => String(input).includes("/deployments?"))).toHaveLength(2);
  });
});
