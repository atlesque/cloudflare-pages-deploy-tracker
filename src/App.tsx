import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ApiWarning, DeploymentSummary, DeploymentsResponse, ProjectDeployment, StatusFilter } from "../shared/types";
import { filterProjects } from "../shared/normalize";

const POLL_OPTIONS = [
  { label: "10 seconds", value: 10_000 },
  { label: "30 seconds", value: 30_000 },
  { label: "1 minute", value: 60_000 },
  { label: "5 minutes", value: 300_000 },
];

type ThemeMode = "auto" | "dark" | "light";
const THEME_STORAGE_KEY = "pages-deploy-tracker-theme";

const readThemeMode = (): ThemeMode => {
  try {
    const saved = window.localStorage.getItem(THEME_STORAGE_KEY);
    return saved === "dark" || saved === "light" || saved === "auto" ? saved : "auto";
  } catch {
    return "auto";
  }
};

const readSystemTheme = (): "dark" | "light" => {
  try {
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  } catch {
    return "dark";
  }
};

const nextThemeMode: Record<ThemeMode, ThemeMode> = { auto: "dark", dark: "light", light: "auto" };
const themeIcon: Record<ThemeMode, string> = { auto: "◐", dark: "☾", light: "☀" };

type LoadState =
  | { status: "idle"; previous?: DeploymentsResponse }
  | { status: "loading"; previous?: DeploymentsResponse }
  | { status: "success"; data: DeploymentsResponse }
  | { status: "error"; message: string; previous?: DeploymentsResponse };

interface ErrorPayload {
  error?: ApiWarning;
}

const statusLabels: Record<StatusFilter, string> = {
  all: "All statuses",
  active: "Active",
  queued: "Queued",
  success: "Successful",
  failure: "Failed",
  canceled: "Canceled",
  unknown: "Unknown",
};

const formatDate = (value?: string): string => {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(date);
};

const formatDuration = (deployment: DeploymentSummary): string => {
  if (!deployment.stageStartedAt) return "—";
  const end = deployment.stageEndedAt ? Date.parse(deployment.stageEndedAt) : Date.now();
  const start = Date.parse(deployment.stageStartedAt);
  if (Number.isNaN(start) || Number.isNaN(end) || end < start) return "—";
  const seconds = Math.floor((end - start) / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes}m ${seconds % 60}s`;
};

const shortCommit = (commit?: string): string => (commit ? commit.slice(0, 8) : "—");

const readProjectPage = (): number => {
  const value = Number(new URLSearchParams(window.location.search).get("page") ?? "1");
  return Number.isInteger(value) && value > 0 ? value : 1;
};

async function getDeployments(signal: AbortSignal, page: number): Promise<DeploymentsResponse> {
  const response = await fetch(`/api/deployments?page=${page}`, { signal, cache: "no-store" });
  const contentType = response.headers.get("content-type") ?? "";
  let body: DeploymentsResponse & ErrorPayload;
  try {
    body = (await response.json()) as DeploymentsResponse & ErrorPayload;
  } catch {
    throw new Error(contentType.includes("text/html") ? "The local deployment API is not running. Start it with `pnpm pages:dev` and refresh this page." : "The deployment service returned an invalid response.");
  }
  if (!response.ok) throw new Error(body.error?.message ?? "The deployment service could not be reached.");
  return body;
}

function App() {
  const [loadState, setLoadState] = useState<LoadState>({ status: "idle" });
  const [isPaused, setIsPaused] = useState(false);
  const [intervalMs, setIntervalMs] = useState(POLL_OPTIONS[0].value);
  const [failureCount, setFailureCount] = useState(0);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(readProjectPage);
  const [themeMode, setThemeMode] = useState<ThemeMode>(readThemeMode);
  const [systemTheme, setSystemTheme] = useState<"dark" | "light">(readSystemTheme);
  const inFlight = useRef(false);
  const mounted = useRef(true);
  const abortController = useRef<AbortController | null>(null);
  const loadStateRef = useRef(loadState);
  loadStateRef.current = loadState;

  useEffect(() => {
    if (!window.matchMedia) return;
    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
    const onThemeChange = (event: MediaQueryListEvent) => setSystemTheme(event.matches ? "dark" : "light");
    mediaQuery.addEventListener?.("change", onThemeChange);
    return () => mediaQuery.removeEventListener?.("change", onThemeChange);
  }, []);

  useEffect(() => {
    const effectiveTheme = themeMode === "auto" ? systemTheme : themeMode;
    document.documentElement.dataset.theme = effectiveTheme;
    document.documentElement.style.colorScheme = effectiveTheme;
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, themeMode);
    } catch {
      // Storage may be unavailable in private browsing; the in-memory preference still works.
    }
  }, [systemTheme, themeMode]);

  const refresh = useCallback(async (requestedPage = page) => {
    if (inFlight.current) return;
    inFlight.current = true;
    abortController.current?.abort();
    const controller = new AbortController();
    abortController.current = controller;
    setLoadState((current) => ({ status: "loading", previous: current.status === "success" ? current.data : current.previous }));
    try {
      const data = await getDeployments(controller.signal, requestedPage);
      if (!mounted.current) return;
      setFailureCount(0);
      setLoadState({ status: "success", data });
    } catch (error) {
      if (!mounted.current || (error instanceof Error && error.name === "AbortError")) return;
      const current = loadStateRef.current;
      const previous = current.status === "success" ? current.data : current.previous;
      setFailureCount((count) => count + 1);
      setLoadState({ status: "error", message: error instanceof Error ? error.message : "The deployment service could not be reached.", previous });
    } finally {
      inFlight.current = false;
      if (abortController.current === controller) abortController.current = null;
    }
  }, [page]);

  useEffect(() => {
    mounted.current = true;
    void refresh();
    return () => {
      mounted.current = false;
      abortController.current?.abort();
    };
  }, [refresh]);

  const hasData = loadState.status === "success" || Boolean(loadState.status === "error" && loadState.previous);
  useEffect(() => {
    if (isPaused || !hasData || loadState.status === "loading") return;
    const delay = Math.min(intervalMs * 2 ** Math.min(failureCount, 3), 120_000);
    const timer = window.setTimeout(() => void refresh(), delay);
    return () => window.clearTimeout(timer);
  }, [failureCount, hasData, intervalMs, isPaused, loadState.status, refresh]);

  const data = loadState.status === "success" ? loadState.data : loadState.status === "error" ? loadState.previous : loadState.status === "loading" ? loadState.previous : undefined;
  const visibleProjects = useMemo(() => (data ? filterProjects(data.projects, statusFilter, query) : []), [data, query, statusFilter]);
  const isRefreshing = loadState.status === "loading" && Boolean(data);
  const hasTotalError = loadState.status === "error" && !data;
  const connectionFailed = loadState.status === "error";

  useEffect(() => {
    const url = new URL(window.location.href);
    if (page === 1) url.searchParams.delete("page");
    else url.searchParams.set("page", String(page));
    window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
  }, [page]);

  useEffect(() => {
    if (data && page > data.pagination.totalPages) setPage(data.pagination.totalPages);
  }, [data, page]);

  const changePage = (nextPage: number) => {
    if (!data || nextPage === page || loadState.status === "loading") return;
    setLoadState((current) => ({ status: "loading", previous: current.status === "success" ? current.data : current.previous }));
    setPage(nextPage);
  };

  return (
    <main className="app-shell">
      <div className="ambient-glow ambient-glow-one" />
      <div className="ambient-glow ambient-glow-two" />
      <header className="topbar">
        <a className="brand" href="/" aria-label="Pages Deploy Tracker home">
          <span className="brand-mark" aria-hidden="true"><span /><span /><span /></span>
          <span><strong>Pages</strong> Deploy Tracker</span>
        </a>
        <div className="topbar-meta">
          <span className={`connection-state ${connectionFailed ? "error" : ""}`}><span className="connection-dot" />{connectionFailed ? "ERROR" : "LIVE"}</span>
          <button className="theme-toggle" type="button" onClick={() => setThemeMode((mode) => nextThemeMode[mode])} aria-label={`Theme mode: ${themeMode}. Switch to ${nextThemeMode[themeMode]}`} title={`Theme: ${themeMode}`}><span aria-hidden="true">{themeIcon[themeMode]}</span></button>
        </div>
      </header>

      <section className="hero" aria-labelledby="page-title">
        <div>
          <h1 id="page-title">Deployments</h1>
        </div>
        <div className="hero-actions">
          <button className="refresh-button" type="button" onClick={() => void refresh()} disabled={loadState.status === "loading"} aria-label="Refresh deployment data">
            <span className={isRefreshing ? "spin" : "refresh-icon"} aria-hidden="true">↻</span>
            {isRefreshing ? "Refreshing" : "Refresh now"}
          </button>
          <label className="poll-control">
            <span>Refresh every</span>
            <select value={intervalMs} onChange={(event) => setIntervalMs(Number(event.target.value))} aria-label="Refresh interval">
              {POLL_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </label>
          <button className="pause-button" type="button" onClick={() => setIsPaused((paused) => !paused)} aria-pressed={isPaused}>
            {isPaused ? "Resume polling" : "Pause polling"}
          </button>
        </div>
      </section>

      {loadState.status === "error" && data && <div className="notice notice-warning" role="alert"><span aria-hidden="true">!</span><span>{loadState.message} Showing the last successful result.</span></div>}

      {data && <>
        <section className="summary-grid" aria-label="Deployment summary">
          <SummaryCard label="Running" value={data.summary.active} tone="active" />
          <SummaryCard label="Queued" value={data.summary.queued} tone="queued" />
          <SummaryCard label="Successful" value={data.summary.success} tone="success" />
          <SummaryCard label="Failed" value={data.summary.failure} tone="failure" />
          <SummaryCard label="Canceled" value={data.summary.canceled} tone="canceled" />
        </section>

        <section className="toolbar" aria-label="Project filters">
          <div className="toolbar-title"><span className="section-kicker">Projects</span><span className="project-count">{visibleProjects.length} of {data.pagination.totalProjects}</span></div>
          <div className="filters">
            <label className="search-field"><span aria-hidden="true">⌕</span><input type="search" placeholder="Search project or branch" value={query} onChange={(event) => setQuery(event.target.value)} aria-label="Search project or branch" /></label>
            <label className="filter-field"><span className="sr-only">Filter by status</span><select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as StatusFilter)} aria-label="Filter by status">
              {(["all", "active", "queued", "success", "failure", "canceled"] as StatusFilter[]).map((status) => <option value={status} key={status}>{statusLabels[status]}</option>)}
            </select></label>
          </div>
        </section>

        {data.warnings.length > 0 && <div className="partial-warning" role="status"><span className="warning-icon" aria-hidden="true">!</span><span>{data.warnings.length} project{data.warnings.length === 1 ? "" : "s"} could not be queried. The rest of the account is still shown.</span></div>}

        {loadState.status === "loading" ? <ProjectLoadingGrid count={data.pagination.perPage} /> : <>
          <section className="project-list" aria-label="Cloudflare Pages projects">
            {visibleProjects.map((project) => <ProjectCard key={project.projectId ?? project.projectName} project={project} />)}
          </section>
          {visibleProjects.length === 0 && <EmptyState hasProjects={data.projects.length > 0} />}
        </>}

        {data.pagination.totalPages > 1 && <nav className="pagination" aria-label="Project pages">
          <button type="button" onClick={() => changePage(Math.max(1, page - 1))} disabled={page <= 1 || loadState.status === "loading"} aria-label="Previous project page">Previous</button>
          <span>Page {data.pagination.page} of {data.pagination.totalPages}</span>
          <button type="button" onClick={() => changePage(Math.min(data.pagination.totalPages, page + 1))} disabled={page >= data.pagination.totalPages || loadState.status === "loading"} aria-label="Next project page">Next</button>
        </nav>}

        <footer className="status-footer"><span><span className="footer-dot" />Last successful refresh {formatDate(data.fetchedAt)}</span><span>{isPaused ? "Polling is paused" : failureCount > 0 ? `Polling backed off after ${failureCount} failed refresh${failureCount === 1 ? "" : "es"}` : `Next refresh in ${POLL_OPTIONS.find((option) => option.value === intervalMs)?.label ?? "a moment"}`}</span></footer>
      </>}

      {loadState.status === "loading" && !data && <LoadingState />}
      {hasTotalError && <ErrorState message={loadState.status === "error" ? loadState.message : ""} onRetry={() => void refresh()} />}
    </main>
  );
}

function SummaryCard({ label, value, tone }: { label: string; value: number; tone: string }) {
  return <div className={`summary-card summary-${tone}`}><div className="summary-card-top"><span className="status-dot" /><span>{label}</span></div><strong>{value}</strong></div>;
}

function ProjectCard({ project }: { project: ProjectDeployment }) {
  const current = project.deployments[0];
  const projectUrl = current?.url ?? (project.subdomain ? `https://${project.subdomain}.pages.dev` : undefined);
  return <article className={`project-card ${current ? `card-${current.status}` : "card-empty"}`}>
    <div className="project-card-header">
      <div className="project-heading"><div className="project-avatar" aria-hidden="true">{project.projectName.slice(0, 1).toUpperCase()}</div><div><h2>{project.projectName}</h2><div className="project-subline">{project.productionBranch ? <><span className="branch-icon" aria-hidden="true">⑂</span>{project.productionBranch}</> : "No production branch configured"}</div></div></div>
      {current ? <StatusBadge status={current.status} /> : <span className="status-badge status-unknown">No deployments</span>}
    </div>
    {project.error && <div className="project-error" role="status"><span aria-hidden="true">!</span>{project.error.message}</div>}
    {current ? <>
      <div className="deployment-hero"><div><span className="deployment-label">Current stage</span><div className="deployment-state"><span className="stage-name">{current.stage.replaceAll("_", " ")}</span></div></div><span className="environment-tag">{current.environment}</span></div>
      <div className="detail-grid"><Detail label="Branch" value={current.branch ?? project.productionBranch ?? "—"} /><Detail label="Commit" value={shortCommit(current.commitHash)} mono /><Detail label="Started" value={formatDate(current.stageStartedAt ?? current.createdAt)} /><Detail label="Duration" value={current.status === "active" ? formatDuration(current) : current.stageEndedAt ? formatDuration(current) : "—"} /></div>
      <div className="project-card-footer"><div className="footer-meta">Updated {formatDate(current.modifiedAt ?? current.createdAt)}{current.commitMessage ? <span className="commit-message" title={current.commitMessage}>“{current.commitMessage}”</span> : null}</div><div className="card-links">{projectUrl && <a href={projectUrl} target="_blank" rel="noreferrer">Open deployment <span aria-hidden="true">↗</span></a>}{project.dashboardUrl && <a className="dashboard-link" href={project.dashboardUrl} target="_blank" rel="noreferrer">Cloudflare <span aria-hidden="true">↗</span></a>}</div></div>
      {project.deployments.length > 1 && <details className="recent-deployments"><summary>Recent deployments <span>{project.deployments.length}</span></summary><div className="history-list">{project.deployments.slice(1, 5).map((deployment) => <div className="history-row" key={deployment.id}><StatusBadge status={deployment.status} /><span>{deployment.environment}</span><span className="history-stage">{deployment.stage.replaceAll("_", " ")}</span><time>{formatDate(deployment.modifiedAt ?? deployment.createdAt)}</time></div>)}</div></details>}
    </> : <div className="empty-project"><span className="empty-project-icon" aria-hidden="true">◌</span><div><strong>No deployments recorded yet</strong><p>This project is accessible, but Cloudflare has not returned a deployment for it.</p></div></div>}
  </article>;
}

function StatusBadge({ status }: { status: string }) { return <span className={`status-badge status-${status}`}><span className="status-dot" />{statusLabels[status as StatusFilter] ?? "Unknown"}</span>; }
function Detail({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) { return <div className="detail"><span>{label}</span><strong className={mono ? "mono" : ""}>{value}</strong></div>; }
function EmptyState({ hasProjects }: { hasProjects: boolean }) { return <div className="empty-state"><div className="empty-orbit" aria-hidden="true">✦</div><h2>{hasProjects ? "No projects match these filters" : "No Pages projects found"}</h2><p>{hasProjects ? "Try a different status or search term." : "The connected Cloudflare account does not have any Pages projects available to this token."}</p></div>; }
function ProjectLoadingGrid({ count }: { count: number }) { return <section className="project-list project-list-loading" aria-label="Loading projects" aria-busy="true">{Array.from({ length: count }, (_, index) => <ProjectSkeleton key={index} />)}</section>; }
function ProjectSkeleton() { return <article className="project-card project-card-skeleton" data-testid="project-skeleton" aria-hidden="true"><div className="skeleton-project-header"><span className="skeleton-block skeleton-avatar" /><span className="skeleton-block skeleton-project-name" /><span className="skeleton-block skeleton-status" /></div><div className="skeleton-stage"><span className="skeleton-block skeleton-label" /><span className="skeleton-block skeleton-stage-name" /></div><div className="skeleton-details"><span className="skeleton-block" /><span className="skeleton-block" /><span className="skeleton-block" /><span className="skeleton-block" /></div><div className="skeleton-project-footer"><span className="skeleton-block" /><span className="skeleton-block" /></div></article>; }
function LoadingState() { return <section className="loading-list" aria-label="Loading projects" aria-busy="true"><div className="loading-summary">Loading your Pages projects…</div><ProjectLoadingGrid count={10} /></section>; }
function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) { return <section className="error-state" role="alert"><div className="error-mark" aria-hidden="true">×</div><h2>Couldn’t load deployment data</h2><p>{message}</p><button className="refresh-button" type="button" onClick={onRetry}>Try again</button></section>; }

export default App;
