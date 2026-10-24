import { ArrowLeft, ArrowUpRight, ChevronRight, CircleAlert, CircleDashed, GitBranch, Pause, Play, RefreshCw } from "lucide-react";
import { formatDate, formatDuration, shortCommit } from "../lib/format";
import { POLL_OPTIONS } from "../lib/polling";
import type { ProjectDeployment } from "../../shared/types";
import { StatusBadge } from "./StatusBadge";

export function ProjectDetailPage({ project, fetchedAt, failureCount, isRefreshing, isPaused, intervalMs, onBack, onRefresh, onIntervalChange, onPause }: { project?: ProjectDeployment; fetchedAt: string; failureCount: number; isRefreshing: boolean; isPaused: boolean; intervalMs: number; onBack: () => void; onRefresh: () => void; onIntervalChange: (value: number) => void; onPause: () => void }) {
  if (!project) return <section className="detail-not-found" role="alert"><button className="back-link" type="button" onClick={onBack}><ArrowLeft className="icon" aria-hidden="true" />Back to projects</button><h1>Project not found</h1><p>This project is not present on the current page of results.</p></section>;
  const isWorker = project.kind === "worker";
  const customDomains = project.domains.filter((domain) => !domain.toLowerCase().endsWith(".pages.dev"));
  return <section className="detail-page" aria-labelledby="project-title">
    <button className="back-link" type="button" onClick={onBack}><ArrowLeft className="icon" aria-hidden="true" />Back to projects</button>
    <div className="detail-page-header"><div><span className="eyebrow">Project monitor</span><h1 id="project-title">{project.projectName}</h1><p>{project.productionBranch ? `${isWorker ? "Worker · " : ""}Production branch · ${project.productionBranch}` : isWorker ? "Cloudflare Worker · Workers Builds" : "Cloudflare Pages project"}</p></div><div className="detail-actions"><button className="refresh-button" type="button" onClick={onRefresh} disabled={isRefreshing} aria-label="Pull latest deployment data"><RefreshCw className={`icon ${isRefreshing ? "spin" : ""}`} aria-hidden="true" />{isRefreshing ? "Pulling" : "Pull latest"}</button><label className="poll-control"><span>Every</span><select value={intervalMs} onChange={(event) => onIntervalChange(Number(event.target.value))} aria-label="Refresh interval">{POLL_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label><button className="pause-button" type="button" onClick={onPause} aria-pressed={isPaused}>{isPaused ? <Play className="icon" aria-hidden="true" /> : <Pause className="icon" aria-hidden="true" />}{isPaused ? "Resume" : "Pause"}</button></div></div>
    {project.error && <div className="project-error" role="status"><CircleAlert className="icon" aria-hidden="true" /><div><strong>{project.error.message}</strong>{project.error.details && <pre className="error-details">{JSON.stringify(project.error.details, null, 2)}</pre>}</div></div>}
    <ProjectMonitor project={project} />
    <section className="project-domains" aria-labelledby="custom-domains-title">
      <h2 id="custom-domains-title">Custom domains</h2>
      {customDomains.length > 0 ? <ul>{customDomains.map((domain) => <li key={domain}><a href={`https://${domain}`} target="_blank" rel="noreferrer">{domain}<ArrowUpRight className="icon" aria-hidden="true" /></a></li>)}</ul> : <p>No custom domains configured.</p>}
    </section>
    <footer className="monitoring-footer"><span><span className={`monitoring-dot ${isPaused ? "paused" : ""}`} aria-hidden="true" />{isPaused ? "Monitoring paused" : "Monitoring live"}</span><span>Last pulled {formatDate(fetchedAt)} · {isPaused ? "Manual pulls only" : failureCount > 0 ? "Retrying with backoff" : `Next pull in ${POLL_OPTIONS.find((option) => option.value === intervalMs)?.label ?? "a moment"}`}</span></footer>
  </section>;
}

function ProjectMonitor({ project }: { project: ProjectDeployment }) {
  const current = project.deployments[0];
  const isWorker = project.kind === "worker";
  const projectUrl = current?.url ?? (project.subdomain ? `https://${project.subdomain}.pages.dev` : isWorker && project.domains[0] ? `https://${project.domains[0]}` : undefined);
  return <article className={`project-monitor ${current ? `card-${current.status}` : "card-empty"}`}>
      <div className="project-card-header">
      <div className="project-heading"><div className="project-avatar" aria-hidden="true">{project.projectName.slice(0, 1).toUpperCase()}</div><div><h2>{project.projectName}</h2><div className="project-subline">{project.productionBranch ? <><GitBranch className="icon branch-icon" aria-hidden="true" />{project.productionBranch}</> : "No production branch configured"}{current && <span className="last-deployed">· Last deployed {formatDate(current.modifiedAt ?? current.createdAt)}</span>}</div></div></div>
      {current ? <StatusBadge status={current.status} /> : <span className="status-badge status-unknown">{isWorker ? "No builds" : "No deployments"}</span>}
    </div>
    {current ? <>
      <div className="deployment-hero"><div><span className="deployment-label">Current stage</span><div className="deployment-state"><span className="stage-name">{current.stage.replaceAll("_", " ")}</span></div></div><span className="environment-tag">{current.environment}</span></div>
      <div className="detail-grid"><Detail label="Branch" value={current.branch ?? project.productionBranch ?? "—"} /><Detail label="Commit" value={shortCommit(current.commitHash)} mono /><Detail label="Started" value={formatDate(current.stageStartedAt ?? current.createdAt)} /><Detail label="Duration" value={current.status === "active" ? formatDuration(current) : current.stageEndedAt ? formatDuration(current) : "—"} /></div>
      <div className="project-card-footer"><div className="footer-meta">Updated {formatDate(current.modifiedAt ?? current.createdAt)}{current.commitMessage ? <span className="commit-message" title={current.commitMessage}>“{current.commitMessage}”</span> : null}</div><div className="card-links">{projectUrl && <a href={projectUrl} target="_blank" rel="noreferrer">Open deployment <ArrowUpRight className="icon" aria-hidden="true" /></a>}{project.dashboardUrl && <a className="dashboard-link" href={project.dashboardUrl} target="_blank" rel="noreferrer">Cloudflare <ArrowUpRight className="icon" aria-hidden="true" /></a>}</div></div>
      {project.deployments.length > 1 && <details className="recent-deployments"><summary><ChevronRight className="icon summary-chevron" aria-hidden="true" />{isWorker ? "Recent builds" : "Recent deployments"} <span>{project.deployments.length}</span></summary><div className="history-list">{project.deployments.slice(1, 5).map((deployment) => <div className="history-row" key={deployment.id}><StatusBadge status={deployment.status} /><span>{deployment.environment}</span><span className="history-stage">{deployment.stage.replaceAll("_", " ")}{isWorker && (deployment.branch || deployment.commitHash) && <span className="history-ref"> · {[deployment.branch, deployment.commitHash && shortCommit(deployment.commitHash)].filter(Boolean).join(" · ")}</span>}</span><time>{formatDate(deployment.modifiedAt ?? deployment.createdAt)}</time></div>)}</div></details>}
    </> : <div className="empty-project"><CircleDashed className="empty-project-icon" aria-hidden="true" /><div><strong>{isWorker ? "No builds recorded yet" : "No deployments recorded yet"}</strong><p>{isWorker ? "This Worker is accessible, but it has no Workers Builds history. Workers deployed without a connected Git repository do not appear here." : "This project is accessible, but Cloudflare has not returned a deployment for it."}</p></div></div>}
  </article>;
}

function Detail({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) { return <div className="detail"><span>{label}</span><strong className={mono ? "mono" : ""}>{value}</strong></div>; }
