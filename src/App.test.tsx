import { act, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import type { DeploymentsResponse } from "../shared/types";

const data: DeploymentsResponse = {
  fetchedAt: "2026-09-02T10:02:00.000Z",
  summary: { totalProjects: 5, active: 1, queued: 1, success: 1, failure: 1, canceled: 1 },
  pagination: { page: 1, perPage: 10, totalProjects: 39, totalPages: 4 },
  warnings: [],
  projects: [
    { projectName: "checkout", projectId: "1", productionBranch: "main", subdomain: "checkout", domains: [], deployments: [{ id: "active", projectName: "checkout", environment: "production", status: "active", stage: "build", stageStartedAt: "2026-09-02T10:00:00Z", modifiedAt: "2026-09-02T10:02:00Z", branch: "main", aliases: [], dashboardUrl: "https://dash.cloudflare.com/account/pages/view/checkout" }] },
    { projectName: "marketing", projectId: "2", productionBranch: "main", domains: [], deployments: [{ id: "queued", projectName: "marketing", environment: "preview", status: "queued", stage: "queued", modifiedAt: "2026-09-02T10:01:00Z", aliases: [] }] },
    { projectName: "docs", projectId: "3", productionBranch: "main", domains: [], deployments: [{ id: "success", projectName: "docs", environment: "production", status: "success", stage: "deploy", modifiedAt: "2026-09-02T10:00:00Z", aliases: [] }] },
    { projectName: "api", projectId: "4", productionBranch: "main", domains: [], deployments: [{ id: "failure", projectName: "api", environment: "production", status: "failure", stage: "build", modifiedAt: "2026-09-02T09:00:00Z", aliases: [] }] },
    { projectName: "legacy", projectId: "5", domains: [], deployments: [{ id: "canceled", projectName: "legacy", environment: "preview", status: "canceled", stage: "deploy", modifiedAt: "2026-09-02T08:00:00Z", aliases: [] }] },
  ],
};

describe("dashboard", () => {
  beforeEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  localStorage.clear();
  window.history.replaceState(null, "", "/");
  });

  it("shows a loading state before the first response", () => {
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>(() => undefined)));
    render(<App />);
    expect(screen.getByText("Pulling your Pages projects…")).toBeInTheDocument();
    expect(screen.getByLabelText("Loading project search")).toBeInTheDocument();
    expect(screen.getAllByTestId("project-skeleton")).toHaveLength(10);
  });

  it("renders a minimal project index", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify(data), { status: 200 })));
    render(<App />);
    expect(await screen.findByText("checkout")).toBeInTheDocument();
    expect(screen.getByLabelText("checkout is currently deploying")).toBeInTheDocument();
    expect(screen.getByText("Deploying")).toBeInTheDocument();
    expect(screen.queryByLabelText("marketing is currently deploying")).not.toBeInTheDocument();
    expect(screen.queryByText("Running")).not.toBeInTheDocument();
    expect(screen.queryByRole("combobox", { name: "Filter by status" })).not.toBeInTheDocument();
    expect(screen.getByText("39 total")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Next project page" })).toBeEnabled();
  });

  it("searches projects from the homepage without triggering polling", async () => {
    const user = userEvent.setup();
    const timerSpy = vi.spyOn(window, "setTimeout");
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify(data), { status: 200 }));
    vi.stubGlobal("fetch", fetcher);
    render(<App />);
    expect(await screen.findByText("checkout")).toBeInTheDocument();
    await user.type(screen.getByRole("searchbox", { name: "Search projects" }), "market");
    expect(screen.getByText("checkout")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Submit project search" }));
    expect(screen.getByText("marketing")).toBeInTheDocument();
    expect(screen.queryByText("checkout")).not.toBeInTheDocument();
    expect(timerSpy.mock.calls.some(([, delay]) => delay === 10_000)).toBe(true);
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it("refreshes the homepage in the background without showing skeletons", async () => {
    vi.useFakeTimers();
    let resolveBackground!: (response: Response) => void;
    const backgroundResponse = new Promise<Response>((resolve) => { resolveBackground = resolve; });
    const refreshedData: DeploymentsResponse = {
      ...data,
      fetchedAt: "2026-09-02T10:12:00.000Z",
      projects: data.projects.map((project) => project.projectName === "checkout"
        ? { ...project, domains: ["checkout.example.com"], deployments: [{ ...project.deployments[0], status: "success" }] }
        : project),
    };
    const fetcher = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify(data), { status: 200 })).mockReturnValueOnce(backgroundResponse);
    vi.stubGlobal("fetch", fetcher);
    render(<App />);
    await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); });
    expect(screen.getByText("checkout")).toBeInTheDocument();
    await act(async () => { vi.advanceTimersByTime(10_000); });
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(screen.getByRole("status", { name: "Refreshing projects" })).toBeInTheDocument();
    expect(screen.queryByTestId("project-skeleton")).not.toBeInTheDocument();
    resolveBackground(new Response(JSON.stringify(refreshedData), { status: 200 }));
    await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); });
    expect(screen.queryByLabelText("checkout is currently deploying")).not.toBeInTheDocument();
    expect(screen.queryByRole("status", { name: "Refreshing projects" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("link", { name: /checkout/ }));
    expect(screen.getByRole("link", { name: "checkout.example.com" })).toHaveAttribute("href", "https://checkout.example.com");
  });

  it("resorts the homepage when a refreshed deployment becomes active", async () => {
    vi.useFakeTimers();
    const refreshedData: DeploymentsResponse = {
      ...data,
      fetchedAt: "2026-09-02T10:12:00.000Z",
      projects: data.projects.map((project) => project.projectName === "marketing"
        ? { ...project, deployments: [{ ...project.deployments[0], status: "active", modifiedAt: "2026-09-02T10:11:00Z" }] }
        : project),
    };
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ ...data, projects: [data.projects[0], data.projects[1]] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ...refreshedData, projects: [refreshedData.projects[1], refreshedData.projects[0]] }), { status: 200 }));
    vi.stubGlobal("fetch", fetcher);
    render(<App />);
    await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); });
    expect(screen.getAllByRole("link").filter((link) => link.className === "project-row").map((link) => link.textContent)).toEqual([
      expect.stringContaining("checkout"),
      expect.stringContaining("marketing"),
    ]);

    await act(async () => { vi.advanceTimersByTime(10_000); });
    await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); });
    expect(screen.getAllByRole("link").filter((link) => link.className === "project-row").map((link) => link.textContent)).toEqual([
      expect.stringContaining("marketing"),
      expect.stringContaining("checkout"),
    ]);
    expect(screen.getByLabelText("marketing is currently deploying")).toBeInTheDocument();
    const expectedLastDeployed = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date("2026-09-02T10:11:00Z"));
    expect(screen.getByRole("link", { name: /marketing/ })).toHaveTextContent(`Last deployed ${expectedLastDeployed}`);
  });

  it("cancels a homepage refresh when opening a project", async () => {
    vi.useFakeTimers();
    let resolveBackground!: (response: Response) => void;
    const backgroundResponse = new Promise<Response>((resolve) => { resolveBackground = resolve; });
    const fetcher = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify(data), { status: 200 })).mockReturnValueOnce(backgroundResponse);
    vi.stubGlobal("fetch", fetcher);
    render(<App />);
    await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); });
    await act(async () => { vi.advanceTimersByTime(10_000); });
    const requestInit = fetcher.mock.calls[1]?.[1] as RequestInit;
    expect(requestInit.signal?.aborted).toBe(false);
    fireEvent.click(screen.getByRole("link", { name: /checkout/ }));
    expect(requestInit.signal?.aborted).toBe(true);
    expect(screen.getByRole("heading", { name: "checkout", level: 1 })).toBeInTheDocument();
    resolveBackground(new Response(JSON.stringify(data), { status: 200 }));
    await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); });
  });

  it("opens a project monitor with pull and polling controls", async () => {
    const user = userEvent.setup();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify(data), { status: 200 })));
    render(<App />);
    await user.click(await screen.findByRole("link", { name: /checkout/ }));
    expect(await screen.findByRole("heading", { name: "checkout", level: 1 })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Pull latest deployment data" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Pause" }));
    expect(screen.getByText("LIVE")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Resume" })).toBeInTheDocument();
    expect(screen.getByText("Monitoring paused")).toBeInTheDocument();
    expect(window.location.pathname).toBe("/projects/checkout");
  });

  it("lists the selected project's custom domains even without deployments", async () => {
    const user = userEvent.setup();
    const projectData: DeploymentsResponse = {
      ...data,
      projects: data.projects.map((project) => project.projectName === "checkout"
        ? { ...project, domains: ["checkout.pages.dev", "checkout.example.com", "shop.example.com"], deployments: [] }
        : { ...project, domains: ["other.example.com"] }),
    };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify(projectData), { status: 200 })));
    render(<App />);
    await user.click(await screen.findByRole("link", { name: /checkout/ }));
    const domains = screen.getByRole("region", { name: "Custom domains" });
    expect(within(domains).getAllByRole("listitem")).toHaveLength(2);
    for (const domain of ["checkout.example.com", "shop.example.com"]) {
      const link = within(domains).getByRole("link", { name: domain });
      expect(link).toHaveAttribute("href", `https://${domain}`);
      expect(link).toHaveAttribute("target", "_blank");
      expect(link).toHaveAttribute("rel", "noreferrer");
    }
    expect(screen.queryByText("other.example.com")).not.toBeInTheDocument();
    expect(within(domains).queryByRole("link", { name: "checkout.pages.dev" })).not.toBeInTheDocument();
    expect(screen.getByText("No deployments recorded yet")).toBeInTheDocument();
  });

  it.each([{ domains: [] }, { domains: ["checkout.pages.dev"] }])("shows an empty state for projects without custom domains (%j)", async ({ domains: projectDomains }) => {
    window.history.replaceState(null, "", "/projects/checkout");
    const projectData = { ...data, projects: [{ ...data.projects[0], domains: projectDomains }] };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify(projectData), { status: 200 })));
    render(<App />);
    const domains = await screen.findByRole("region", { name: "Custom domains" });
    expect(within(domains).getByText("No custom domains configured.")).toBeInTheDocument();
    expect(within(domains).queryByRole("list")).not.toBeInTheDocument();
  });

  it("shows ERROR when the deployment connection fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("Connection failed")));
    render(<App />);
    expect(await screen.findByText("ERROR")).toBeInTheDocument();
  });

  it("shows structured API diagnostics when the deployment service returns an error", async () => {
    const error = { code: "CLOUDFLARE_HTTP_502", message: "upstream failed", status: 502, details: { requestId: "req-1", endpoint: "/accounts/{account}/pages/projects", responseBody: "gateway down" } };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ error }), { status: 502, headers: { "Content-Type": "application/json" } })));
    render(<App />);
    expect(await screen.findByText(/upstream failed/)).toBeInTheDocument();
    expect(screen.getByText(/requestId/)).toBeInTheDocument();
    expect(screen.getByText(/gateway down/)).toBeInTheDocument();
  });

  it("navigates between project pages and updates the URL", async () => {
    const user = userEvent.setup();
    vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      const pageData = url.includes("page=2")
        ? { ...data, pagination: { ...data.pagination, page: 2 }, projects: [data.projects[1]] }
        : data;
      return Promise.resolve(new Response(JSON.stringify(pageData), { status: 200 }));
    }));
    render(<App />);
    await screen.findByText("checkout");
    await user.click(screen.getByRole("button", { name: "Next project page" }));
    expect(await screen.findByText("marketing")).toBeInTheDocument();
    expect(screen.getByText("Page 2 of 4")).toBeInTheDocument();
    expect(window.location.search).toBe("?page=2");
  });

  it("shows project skeletons while loading another page", async () => {
    const user = userEvent.setup();
    let resolveNextPage!: (response: Response) => void;
    const nextPage = new Promise<Response>((resolve) => { resolveNextPage = resolve; });
    vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL) => {
      if (String(input).includes("page=2")) return nextPage;
      return Promise.resolve(new Response(JSON.stringify(data), { status: 200 }));
    }));
    render(<App />);
    await screen.findByText("checkout");
    await user.click(screen.getByRole("button", { name: "Next project page" }));
    expect(screen.getAllByTestId("project-skeleton")).toHaveLength(10);
    expect(screen.queryByRole("heading", { name: "checkout" })).not.toBeInTheDocument();
    resolveNextPage(new Response(JSON.stringify({ ...data, pagination: { ...data.pagination, page: 2 }, projects: [data.projects[1]] }), { status: 200 }));
    expect(await screen.findByText("marketing")).toBeInTheDocument();
  });

  it("cycles theme modes and persists the selected mode", async () => {
    const user = userEvent.setup();
    localStorage.clear();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify(data), { status: 200 })));
    render(<App />);
    await screen.findByText("checkout");
    const themeButton = screen.getByRole("button", { name: "Theme mode: auto. Switch to dark" });
    await user.click(themeButton);
    expect(themeButton).toHaveAttribute("aria-label", "Theme mode: dark. Switch to light");
    expect(localStorage.getItem("pages-deploy-tracker-theme")).toBe("dark");
    await user.click(themeButton);
    expect(themeButton).toHaveAttribute("aria-label", "Theme mode: light. Switch to auto");
    await user.click(themeButton);
    expect(themeButton).toHaveAttribute("aria-label", "Theme mode: auto. Switch to dark");
  });

  it("turns the sticky top bar into glass when scrolling", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify(data), { status: 200 })));
    render(<App />);
    await screen.findByText("checkout");
    const topbar = document.querySelector(".topbar");
    expect(topbar).not.toHaveClass("topbar-scrolled");
    Object.defineProperty(window, "scrollY", { configurable: true, value: 32 });
    fireEvent.scroll(window);
    expect(topbar).toHaveClass("topbar-scrolled");
    Object.defineProperty(window, "scrollY", { configurable: true, value: 0 });
    fireEvent.scroll(window);
    expect(topbar).not.toHaveClass("topbar-scrolled");
  });
});
