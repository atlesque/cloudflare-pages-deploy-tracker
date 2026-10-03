import { useEffect, useMemo, useState } from "react";
import { filterProjects } from "../shared/normalize";
import { useDeployments } from "./hooks/useDeployments";
import { ProjectDetailPage } from "./components/ProjectDetailPage";
import { ProjectIndexPage } from "./components/ProjectIndexPage";
import { ErrorState, LoadingState } from "./components/states";
import { formatDate } from "./lib/format";
import { POLL_OPTIONS } from "./lib/polling";
import { readProjectPage, readSelectedProject } from "./lib/routing";
import { nextThemeMode, readSystemTheme, readThemeMode, themeIcon, THEME_STORAGE_KEY, type ThemeMode } from "./lib/theme";

function App() {
  const [isPaused, setIsPaused] = useState(false);
  const [intervalMs, setIntervalMs] = useState(POLL_OPTIONS[0].value);
  const [page, setPage] = useState(readProjectPage);
  const [query, setQuery] = useState("");
  const [selectedProjectName, setSelectedProjectName] = useState<string | null>(readSelectedProject);
  const [themeMode, setThemeMode] = useState<ThemeMode>(readThemeMode);
  const [systemTheme, setSystemTheme] = useState<"dark" | "light">(readSystemTheme);
  const [isTopbarScrolled, setIsTopbarScrolled] = useState(false);

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

  const { loadState, setLoadState, failureCount, isBackgroundRefreshing, data, refresh } = useDeployments({ page, selectedProjectName, isPaused, intervalMs });

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

export default App;
