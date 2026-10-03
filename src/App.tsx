import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { filterProjects, sortProjects } from "../shared/normalize";
import type { ApiWarning, DeploymentSummary, DeploymentsResponse, ProjectDeployment, StatusFilter } from "../shared/types";

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

const mergeProjectData = (previous: DeploymentsResponse, next: DeploymentsResponse): DeploymentsResponse => ({
  ...next,
  projects: sortProjects(next.projects.map((refreshedProject) => {
    const previousProject = previous.projects.find((project) => project.projectName === refreshedProject.projectName);
    return previousProject ? { ...previousProject, domains: refreshedProject.domains, deployments: refreshedProject.deployments, error: refreshedProject.error } : refreshedProject;
  })),
});

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

const readSelectedProject = (): string | null => {
  const match = window.location.pathname.match(/^\/projects\/([^/]+)\/?$/);
  if (!match) return null;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return match[1];
  }
};

async function getDeployments(signal: AbortSignal, page: number): Promise<DeploymentsResponse> {
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

function App() {
  const [loadState, setLoadState] = useState<LoadState>({ status: "idle" });
  const [isPaused, setIsPaused] = useState(false);
  const [intervalMs, setIntervalMs] = useState(POLL_OPTIONS[0].value);
  const [failureCount, setFailureCount] = useState(0);
  const [page, setPage] = useState(readProjectPage);
  const [query, setQuery] = useState("");
  const [selectedProjectName, setSelectedProjectName] = useState<string | null>(readSelectedProject);
  const [themeMode, setThemeMode] = useState<ThemeMode>(readThemeMode);
  const [systemTheme, setSystemTheme] = useState<"dark" | "light">(readSystemTheme);
  const inFlight = useRef(false);
  const backgroundInFlight = useRef(false);
  const mounted = useRef(true);
  const abortController = useRef<AbortController | null>(null);
  const backgroundAbortController = useRef<AbortController | null>(null);
  const loadStateRef = useRef(loadState);
  const [isBackgroundRefreshing, setIsBackgroundRefreshing] = useState(false);
  const [isTopbarScrolled, setIsTopbarScrolled] = useState(false);
  loadStateRef.current = loadState;

  useEffect(() => {
    if (!window.matchMedia) return;
    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
    const onThemeChange = (event: MediaQueryListEvent) => setSystemTheme(event.matches ? "dark" : "light");
    mediaQuery.addEventListener?.("change", onThemeChange);
    return () => mediaQuery.removeEventListener?.("change", onThemeChange);
  }, []);

  useEffect(() => {
    const onPopState = () => setSelectedProjectName(readSelectedProject());
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  useEffect(() => {
    const onScroll = () => setIsTopbarScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
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
      console.error("[pages-deploy-tracker] browser_request_error", JSON.stringify({ endpoint: `/api/deployments?page=${requestedPage}`, method: "GET", page: requestedPage, error: error instanceof Error ? error.message : String(error) }));
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
    if (!selectedProjectName || isPaused || !hasData || loadState.status === "loading") return;
    const delay = Math.min(intervalMs * 2 ** Math.min(failureCount, 3), 120_000);
    const timer = window.setTimeout(() => void refresh(), delay);
    return () => window.clearTimeout(timer);
  }, [failureCount, hasData, intervalMs, isPaused, loadState.status, refresh, selectedProjectName]);

  const data = loadState.status === "success" ? loadState.data : loadState.status === "error" ? loadState.previous : loadState.status === "loading" ? loadState.previous : undefined;

  const backgroundRefresh = useCallback(async (requestedPage = page) => {
    if (backgroundInFlight.current || !mounted.current) return;
    backgroundInFlight.current = true;
    const controller = new AbortController();
    backgroundAbortController.current = controller;
    setIsBackgroundRefreshing(true);
    try {
      const refreshedData = await getDeployments(controller.signal, requestedPage);
      if (!mounted.current || controller.signal.aborted) return;
      const current = loadStateRef.current;
      const previous = current.status === "success" ? current.data : current.previous;
      const mergedData = previous ? mergeProjectData(previous, refreshedData) : refreshedData;
      setFailureCount(0);
      setLoadState({ status: "success", data: mergedData });
    } catch (error) {
      if (!mounted.current || (error instanceof Error && error.name === "AbortError")) return;
      const current = loadStateRef.current;
      const previous = current.status === "success" ? current.data : current.previous;
      console.error("[pages-deploy-tracker] browser_background_refresh_error", JSON.stringify({ endpoint: `/api/deployments?page=${requestedPage}`, method: "GET", page: requestedPage, error: error instanceof Error ? error.message : String(error) }));
      setFailureCount((count) => count + 1);
      setLoadState({ status: "error", message: error instanceof Error ? error.message : "The deployment service could not be reached.", previous });
    } finally {
      backgroundInFlight.current = false;
      if (backgroundAbortController.current === controller) backgroundAbortController.current = null;
      if (mounted.current) setIsBackgroundRefreshing(false);
    }
  }, [page]);

  useEffect(() => {
    if (selectedProjectName || !data || loadState.status === "loading") return;
    const timer = window.setTimeout(() => void backgroundRefresh(), 10_000);
    return () => {
      window.clearTimeout(timer);
      backgroundAbortController.current?.abort();
    };
  }, [backgroundRefresh, data, loadState.status, page, selectedProjectName]);

  const visibleProjects = useMemo(() => data ? filterProjects(data.projects, "all", query) : [], [data, query]);
  const selectedProject = useMemo(() => visibleProjects.find((project) => project.projectName === selectedProjectName), [selectedProjectName, visibleProjects]);
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

  const openProject = (projectName: string) => {
    const url = new URL(window.location.href);
    url.pathname = `/projects/${encodeURIComponent(projectName)}`;
    window.history.pushState(null, "", `${url.pathname}${url.search}`);
    setSelectedProjectName(projectName);
  };

  const goHome = () => {
    const url = new URL(window.location.href);
    url.pathname = "/";
    window.history.pushState(null, "", `${url.pathname}${url.search}`);
    setSelectedProjectName(null);
  };

  return (
    <main className="app-shell">
      <div className="ambient-glow ambient-glow-one" />
      <div className="ambient-glow ambient-glow-two" />
      <header className={`topbar ${isTopbarScrolled ? "topbar-scrolled" : ""}`}>
        <a className="brand" href="/" aria-label="Pages Deploy Tracker home" onClick={(event) => { if (selectedProjectName) { event.preventDefault(); goHome(); } }}>
          <span className="brand-mark" aria-hidden="true"><span /><span /><span /></span>
          <span><strong>Pages</strong> Deploy Tracker</span>
        </a>
        <div className="topbar-meta">
          <span className="live-status">
            {isBackgroundRefreshing && <span className="background-refresh-indicator" role="status" aria-label="Refreshing projects" title="Refreshing projects"><span className="background-refresh-spinner" aria-hidden="true"><span /><span /></span></span>}
            <span className={`connection-state ${connectionFailed ? "error" : ""}`}><span className="connection-dot" />{connectionFailed ? "ERROR" : "LIVE"}</span>
          </span>
          <button className="theme-toggle" type="button" onClick={() => setThemeMode((mode) => nextThemeMode[mode])} aria-label={`Theme mode: ${themeMode}. Switch to ${nextThemeMode[themeMode]}`} title={`Theme: ${themeMode}`}><span aria-hidden="true">{themeIcon[themeMode]}</span></button>
        </div>
      </header>

      {selectedProjectName && data ? <ProjectDetailPage
        project={selectedProject}
        fetchedAt={data.fetchedAt}
        failureCount={failureCount}
        isRefreshing={isRefreshing}
        isPaused={isPaused}
        intervalMs={intervalMs}
        onBack={goHome}
        onRefresh={() => void refresh()}
        onIntervalChange={setIntervalMs}
        onPause={() => setIsPaused((paused) => !paused)}
      /> : !selectedProjectName ? <ProjectIndexPage projects={visibleProjects} data={data} query={query} onSearch={setQuery} loading={loadState.status === "loading"} onProjectClick={openProject} /> : null}

      {loadState.status === "error" && data && !selectedProjectName && <div className="notice notice-warning" role="alert"><span aria-hidden="true">!</span><span>{loadState.message} Showing the last successful result.</span></div>}

      {data && !selectedProjectName && <>
        {data.warnings.length > 0 && <div className="partial-warning" role="status"><span className="warning-icon" aria-hidden="true">!</span><span>{data.warnings.length} project{data.warnings.length === 1 ? "" : "s"} could not be queried. The rest of the account is still shown.</span></div>}

        {data.pagination.totalPages > 1 && <nav className="pagination" aria-label="Project pages">
          <button type="button" onClick={() => changePage(Math.max(1, page - 1))} disabled={page <= 1 || loadState.status === "loading"} aria-label="Previous project page">Previous</button>
          <span>Page {data.pagination.page} of {data.pagination.totalPages}</span>
          <button type="button" onClick={() => changePage(Math.min(data.pagination.totalPages, page + 1))} disabled={page >= data.pagination.totalPages || loadState.status === "loading"} aria-label="Next project page">Next</button>
        </nav>}

        {!selectedProjectName && <footer className="status-footer"><span><span className="footer-dot" />Last pulled {formatDate(data.fetchedAt)}</span></footer>}
      </>}

      {loadState.status === "loading" && !data && <LoadingState />}
      {hasTotalError && <ErrorState message={loadState.status === "error" ? loadState.message : ""} onRetry={() => void refresh()} />}
    </main>
  );
}

function ProjectIndexPage({ projects, data, loading, query, onSearch, onProjectClick }: { projects: ProjectDeployment[]; data?: DeploymentsResponse; loading: boolean; query: string; onSearch: (value: string) => void; onProjectClick: (projectName: string) => void }) {
  const [draftQuery, setDraftQuery] = useState(query);
  const submitSearch = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    onSearch(draftQuery);
  };
  return <section className="index-page" aria-labelledby="page-title">
    <div className="index-heading"><div><h1 id="page-title">Projects</h1></div>{data && <span className="project-count">{data.pagination.totalProjects} total</span>}</div>
    {data ? <form className="search-field project-search" onSubmit={submitSearch}><button className="search-submit" type="submit" aria-label="Submit project search">⌕</button><input type="search" placeholder="Search projects or branches" value={draftQuery} onChange={(event) => setDraftQuery(event.target.value)} aria-label="Search projects" /></form> : loading ? <div className="search-field project-search project-search-skeleton" aria-label="Loading project search" aria-busy="true"><span /></div> : null}
    {loading ? data ? <ProjectIndexLoading count={data.pagination.perPage} /> : null : projects.length > 0 ? <div className="project-index-list" aria-label="Cloudflare Pages projects">{projects.map((project) => <ProjectRow key={project.projectId ?? project.projectName} project={project} onClick={onProjectClick} />)}</div> : <EmptyState hasProjects={Boolean(data?.projects.length)} />}
  </section>;
}

function ProjectRow({ project, onClick }: { project: ProjectDeployment; onClick: (projectName: string) => void }) {
  const isDeploying = project.deployments[0]?.status === "active";
  return <a className="project-row" href={`/projects/${encodeURIComponent(project.projectName)}`} onClick={(event) => { event.preventDefault(); onClick(project.projectName); }}>
    <span className="project-row-identity"><span className="project-avatar" aria-hidden="true">{project.projectName.slice(0, 1).toUpperCase()}</span><span><strong>{project.projectName}</strong><small>{project.productionBranch ? `⑂ ${project.productionBranch}` : "No production branch configured"}{project.deployments[0] && <span className="last-deployed">· Last deployed {formatDate(project.deployments[0].modifiedAt ?? project.deployments[0].createdAt)}</span>}</small></span></span>
    <span className="project-row-actions">
      {isDeploying && <span className="project-row-status" aria-label={`${project.projectName} is currently deploying`}><span className="project-row-status-dot" aria-hidden="true" />Deploying</span>}
      <span className="project-row-arrow" aria-hidden="true">↗</span>
    </span>
  </a>;
}

function ProjectDetailPage({ project, fetchedAt, failureCount, isRefreshing, isPaused, intervalMs, onBack, onRefresh, onIntervalChange, onPause }: { project?: ProjectDeployment; fetchedAt: string; failureCount: number; isRefreshing: boolean; isPaused: boolean; intervalMs: number; onBack: () => void; onRefresh: () => void; onIntervalChange: (value: number) => void; onPause: () => void }) {
  if (!project) return <section className="detail-not-found" role="alert"><button className="back-link" type="button" onClick={onBack}>← Back to projects</button><h1>Project not found</h1><p>This project is not present on the current page of results.</p></section>;
  const customDomains = project.domains.filter((domain) => !domain.toLowerCase().endsWith(".pages.dev"));
  return <section className="detail-page" aria-labelledby="project-title">
    <button className="back-link" type="button" onClick={onBack}>← Back to projects</button>
    <div className="detail-page-header"><div><span className="eyebrow">Project monitor</span><h1 id="project-title">{project.projectName}</h1><p>{project.productionBranch ? `Production branch · ${project.productionBranch}` : "Cloudflare Pages project"}</p></div><div className="detail-actions"><button className="refresh-button" type="button" onClick={onRefresh} disabled={isRefreshing} aria-label="Pull latest deployment data"><span className={isRefreshing ? "spin" : "refresh-icon"} aria-hidden="true">↻</span>{isRefreshing ? "Pulling" : "Pull latest"}</button><label className="poll-control"><span>Every</span><select value={intervalMs} onChange={(event) => onIntervalChange(Number(event.target.value))} aria-label="Refresh interval">{POLL_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label><button className="pause-button" type="button" onClick={onPause} aria-pressed={isPaused}>{isPaused ? "Resume" : "Pause"}</button></div></div>
    {project.error && <div className="project-error" role="status"><span aria-hidden="true">!</span><div><strong>{project.error.message}</strong>{project.error.details && <pre className="error-details">{JSON.stringify(project.error.details, null, 2)}</pre>}</div></div>}
    <ProjectMonitor project={project} />
    <section className="project-domains" aria-labelledby="custom-domains-title">
      <h2 id="custom-domains-title">Custom domains</h2>
      {customDomains.length > 0 ? <ul>{customDomains.map((domain) => <li key={domain}><a href={`https://${domain}`} target="_blank" rel="noreferrer">{domain}<span aria-hidden="true">↗</span></a></li>)}</ul> : <p>No custom domains configured.</p>}
    </section>
    <footer className="monitoring-footer"><span><span className={`monitoring-dot ${isPaused ? "paused" : ""}`} />{isPaused ? "Monitoring paused" : "Monitoring live"}</span><span>Last pulled {formatDate(fetchedAt)} · {isPaused ? "Manual pulls only" : failureCount > 0 ? "Retrying with backoff" : `Next pull in ${POLL_OPTIONS.find((option) => option.value === intervalMs)?.label ?? "a moment"}`}</span></footer>
  </section>;
}

function ProjectMonitor({ project }: { project: ProjectDeployment }) {
  const current = project.deployments[0];
  const projectUrl = current?.url ?? (project.subdomain ? `https://${project.subdomain}.pages.dev` : undefined);
  return <article className={`project-monitor ${current ? `card-${current.status}` : "card-empty"}`}>
      <div className="project-card-header">
      <div className="project-heading"><div className="project-avatar" aria-hidden="true">{project.projectName.slice(0, 1).toUpperCase()}</div><div><h2>{project.projectName}</h2><div className="project-subline">{project.productionBranch ? <><span className="branch-icon" aria-hidden="true">⑂</span>{project.productionBranch}</> : "No production branch configured"}{current && <span className="last-deployed">· Last deployed {formatDate(current.modifiedAt ?? current.createdAt)}</span>}</div></div></div>
      {current ? <StatusBadge status={current.status} /> : <span className="status-badge status-unknown">No deployments</span>}
    </div>
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
function ProjectIndexLoading({ count }: { count: number }) { return <div className="project-index-list project-index-loading" aria-label="Loading projects" aria-busy="true">{Array.from({ length: count }, (_, index) => <div className="project-row-skeleton" data-testid="project-skeleton" key={index}><span /><span /><span /></div>)}</div>; }
function LoadingState() { return <section className="loading-list" aria-label="Loading projects" aria-busy="true"><div className="loading-summary">Pulling your Pages projects…</div><ProjectIndexLoading count={10} /></section>; }
function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) { return <section className="error-state" role="alert"><div className="error-mark" aria-hidden="true">×</div><h2>Couldn’t load deployment data</h2><pre className="error-details">{message}</pre><button className="refresh-button" type="button" onClick={onRetry}>Try again</button></section>; }

export default App;
