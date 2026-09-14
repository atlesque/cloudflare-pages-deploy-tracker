import { describe, expect, it } from "vitest";
import { calculateSummary, filterProjects, mapDeploymentStatus, normalizeDeployment, sortProjects, type CloudflareDeployment } from "./normalize";
import type { ProjectDeployment } from "./types";

const deployment = (overrides: Partial<CloudflareDeployment> = {}): CloudflareDeployment => ({
  id: "dep-1",
  project_name: "console",
  environment: "production",
  latest_stage: { name: "build", status: "active", started_on: "2026-09-02T10:00:00.000Z" },
  created_on: "2026-09-02T09:59:00.000Z",
  modified_on: "2026-09-02T10:02:00.000Z",
  deployment_trigger: { metadata: { branch: "main", commit_hash: "abcdef123456", commit_message: "Ship dashboard" } },
  url: "https://console.pages.dev",
  aliases: ["https://main.console.pages.dev"],
  ...overrides,
});

describe("deployment normalization", () => {
  it("preserves the stable UI fields and derives links", () => {
    expect(normalizeDeployment(deployment(), "account-123")).toMatchObject({
      id: "dep-1",
      projectName: "console",
      status: "active",
      stage: "build",
      branch: "main",
      commitHash: "abcdef123456",
      url: "https://console.pages.dev",
      dashboardUrl: "https://dash.cloudflare.com/account-123/pages/view/console",
    });
  });

  it.each([
    [{ name: "queued", status: "idle" }, "queued"],
    [{ name: "build", status: "active" }, "active"],
    [{ name: "deploy", status: "success" }, "success"],
    [{ name: "build", status: "failure" }, "failure"],
    [{ name: "deploy", status: "canceled" }, "canceled"],
  ])("maps stage %j to %s", (stage, expected) => {
    expect(mapDeploymentStatus(stage)).toBe(expected);
  });

  it("handles missing optional fields without throwing", () => {
    expect(normalizeDeployment({ latest_stage: null }, "account")).toMatchObject({
      projectName: "Unknown project",
      environment: "unknown",
      status: "unknown",
      stage: "unknown",
      aliases: [],
    });
  });
});

const project = (name: string, status: ProjectDeployment["deployments"][number]["status"], modifiedAt: string): ProjectDeployment => ({
  projectName: name,
  domains: [],
  deployments: [{ ...normalizeDeployment(deployment({ id: name, latest_stage: { name: "build", status }, modified_on: modifiedAt }), "account"), status }],
});

describe("project summaries", () => {
  it("counts one current deployment per project", () => {
    const projects = [project("active", "active", "2026-09-02T10:00:00Z"), project("failed", "failure", "2026-09-02T09:00:00Z"), project("done", "success", "2026-09-02T08:00:00Z")];
    expect(calculateSummary(projects)).toEqual({ totalProjects: 3, active: 1, queued: 0, success: 1, failure: 1, canceled: 0 });
  });

  it("sorts projects by most recent deployment before status", () => {
    const projects = [project("done", "success", "2026-09-02T12:00:00Z"), project("failed", "failure", "2026-09-02T08:00:00Z"), project("active", "active", "2026-09-02T07:00:00Z"), { projectName: "empty", domains: [], deployments: [] }];
    expect(sortProjects(projects).map(({ projectName }) => projectName)).toEqual(["done", "failed", "active", "empty"]);
  });

  it("filters by current status and project or branch text", () => {
    const projects = [{ ...project("console", "active", "2026-09-02T10:00:00Z"), deployments: [{ ...project("console", "active", "2026-09-02T10:00:00Z").deployments[0], branch: "feature/search" }] }, project("marketing", "success", "2026-09-02T09:00:00Z")];
    expect(filterProjects(projects, "active", "search").map(({ projectName }) => projectName)).toEqual(["console"]);
    expect(filterProjects(projects, "failure", "")).toEqual([]);
  });
});
