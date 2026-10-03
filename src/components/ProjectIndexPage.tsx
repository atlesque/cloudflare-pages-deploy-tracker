import { useState, type FormEvent } from "react";
import { formatDate } from "../lib/format";
import type { DeploymentsResponse, ProjectDeployment } from "../../shared/types";
import { EmptyState } from "./states";

export function ProjectIndexPage({ projects, data, loading, query, onSearch, onProjectClick }: { projects: ProjectDeployment[]; data?: DeploymentsResponse; loading: boolean; query: string; onSearch: (value: string) => void; onProjectClick: (projectName: string) => void }) {
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

export function ProjectIndexLoading({ count }: { count: number }) { return <div className="project-index-list project-index-loading" aria-label="Loading projects" aria-busy="true">{Array.from({ length: count }, (_, index) => <div className="project-row-skeleton" data-testid="project-skeleton" key={index}><span /><span /><span /></div>)}</div>; }
