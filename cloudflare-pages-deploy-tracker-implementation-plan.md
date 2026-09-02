# Cloudflare Pages Deploy Tracker — Implementation Plan

**Status:** Draft for handoff  
**Scope:** Read-only monitoring of Cloudflare Pages deployments  
**Recommended hosting:** Cloudflare Pages with a Pages Function API proxy  
**Recommended stack:** TypeScript, React, Vite, Cloudflare Pages Functions

## 1. Objective

Build a small dashboard that shows the current deployment state of every Cloudflare Pages project accessible in one Cloudflare account.

The dashboard should make it immediately clear:

- Which projects currently have a running deployment.
- Which stage each deployment is in.
- Whether the latest deployment succeeded, failed, was canceled, or is still queued.
- Which branch, commit, environment, and deployment URL are involved.
- When the data was last refreshed and whether any project could not be queried.

The first version is a read-only monitor. It will not trigger, cancel, delete, retry, or modify deployments.

## 2. API basis and assumptions

Cloudflare exposes the Pages project list at:

```text
GET /accounts/{account_id}/pages/projects
```

Deployments are queried per project at:

```text
GET /accounts/{account_id}/pages/projects/{project_name}/deployments
```

The deployment response includes `latest_stage`, including the stage name, status, and timestamps. The stage names documented by Cloudflare are `queued`, `initialize`, `clone_repo`, `build`, and `deploy`; statuses include `idle`, `active`, `success`, `failure`, and `canceled`.

The implementation must treat the Cloudflare API schema as the source of truth at implementation time. Confirm pagination fields, response envelopes, error formats, and deployment fields against the current API reference before coding the client.

References:

- [Cloudflare Pages API reference](https://developers.cloudflare.com/api/resources/pages/)
- [Cloudflare Pages REST API](https://developers.cloudflare.com/pages/configuration/api/)
- [Cloudflare API token permissions](https://developers.cloudflare.com/fundamentals/api/reference/permissions/)

## 3. Proposed architecture

```text
Browser
  │
  │ same-origin GET /api/deployments
  ▼
Pages Function API proxy
  │  reads server-side secrets
  │  lists projects
  │  fetches deployments per project
  │  normalizes and aggregates results
  ▼
Cloudflare Pages API
```

### Why use a server-side proxy

- The Cloudflare API token must never be sent to or bundled into browser JavaScript.
- The proxy avoids browser CORS issues.
- The proxy can centralize pagination, retry handling, concurrency limits, and response normalization.
- The browser receives only the fields needed by the dashboard.

### Runtime and storage

- Use a static React/Vite frontend.
- Use a Pages Function for the read-only API endpoint.
- Do not add D1, KV, R2, or a database in v1.
- Keep the latest result in browser memory only.
- Add a short server-side cache only if API volume or rate limits require it.

## 4. Functional requirements

### Dashboard

The main view should provide:

- A summary bar with counts for running, queued, successful, failed, and canceled deployments.
- A project list sorted with active or queued deployments first, followed by the most recently updated projects.
- One row or card per Pages project.
- Clear status badges with text and color, not color alone.
- Current stage, for example `build` or `deploy`.
- Environment: production or preview, when present.
- Branch and commit metadata, when present.
- Start time, last modification time, and elapsed duration for active stages.
- Links to the deployment URL and the Cloudflare dashboard when those URLs are available.
- Per-project error state when one project fails while others load successfully.
- Last successful refresh time.

### Controls

- Automatic polling with a configurable default interval, proposed at 10 seconds.
- Manual refresh button.
- Pause/resume polling.
- Filter by status: all, active, queued, success, failure, canceled.
- Optional text filter by project name or branch.
- Clear indication when polling is paused or the last refresh failed.

### Empty and degraded states

Handle these explicitly:

- No Pages projects found.
- Projects exist but have no deployments.
- Some project requests succeed and others fail.
- Cloudflare authentication failure.
- Cloudflare rate limiting.
- Cloudflare API outage or timeout.
- Malformed or partially missing deployment fields.

## 5. Backend/API implementation

### Endpoint

Implement a same-origin endpoint such as:

```text
GET /api/deployments
```

Suggested response shape:

```ts
interface DeploymentsResponse {
  fetchedAt: string;
  projects: ProjectDeployment[];
  summary: {
    totalProjects: number;
    active: number;
    queued: number;
    success: number;
    failure: number;
    canceled: number;
  };
  warnings: ApiWarning[];
}

interface ProjectDeployment {
  projectName: string;
  projectId?: string;
  productionBranch?: string;
  subdomain?: string;
  domains?: string[];
  deployments: DeploymentSummary[];
  error?: ApiWarning;
}
```

The exact normalized shape can be adjusted after inspecting real API responses. Preserve the raw Cloudflare payload only in server logs during development; do not expose unnecessary fields to the client.

### Fetch flow

1. Validate that the required server configuration exists.
2. Fetch all Pages projects, following documented pagination.
3. For each project, fetch the most recent relevant deployments, following pagination only as needed.
4. Use bounded concurrency rather than firing an unbounded request for every project at once.
5. Use `Promise.allSettled`-style handling so one project failure does not hide the rest of the account.
6. Normalize each deployment into stable UI fields.
7. Calculate summary counts on the server or in one shared normalization layer.
8. Return a timestamped response with warnings for partial failures.

### Selection and sorting

For v1, retrieve enough recent deployments to identify the current state. Prefer the newest deployment per project/environment unless the UI explicitly needs a short history.

Sort using this priority:

1. Active deployments.
2. Queued deployments.
3. Failed deployments.
4. Other recent deployments.
5. Projects without deployments.

Within a group, sort by newest `modified_on` or equivalent timestamp.

### Resilience

- Apply request timeouts with `AbortController`.
- Retry transient 429 and 5xx responses with a small exponential backoff.
- Do not retry 401, 403, 404, or validation failures automatically.
- Surface rate-limit and authentication errors as actionable warnings.
- Avoid logging the `Authorization` header, token, or complete secret-bearing environment objects.
- Return a stable JSON error envelope for total failures.

## 6. Authentication and configuration

Use a narrowly scoped Cloudflare API token with `Pages Read` access for the target account. Cloudflare documents `Pages Read` as the read-only permission for viewing Pages projects.

Expected server-side configuration:

```text
CLOUDFLARE_ACCOUNT_ID
CLOUDFLARE_API_TOKEN
```

Local development:

- Store local values in an ignored `.dev.vars` file.
- Commit only `.dev.vars.example` with placeholder values.
- Never put the token in `VITE_*` variables, frontend source, query parameters, or committed configuration.

Production access:

- Prefer protecting the deployed dashboard with Cloudflare Access or an equivalent private access layer.
- Keep the API endpoint same-origin and do not enable permissive CORS unless a separate client is intentionally added.
- Document how to rotate or revoke the token.

## 7. Suggested project structure

```text
cloudflare-pages-deploy-tracker/
├── src/
│   ├── components/
│   ├── lib/
│   ├── types/
│   ├── App.tsx
│   └── main.tsx
├── functions/
│   ├── api/
│   │   └── deployments.ts
│   └── _middleware.ts             # optional access/error middleware
├── tests/
│   ├── api-normalization.test.ts
│   ├── polling.test.ts
│   └── dashboard.test.tsx
├── public/
├── .dev.vars.example
├── .gitignore
├── package.json
├── tsconfig.json
├── vite.config.ts
├── wrangler.jsonc
└── README.md
```

Use a dedicated repository for this tracker. The existing local `Cloudflare Workers Notifications` repository is related but is not the tracker itself; do not mix the two projects without an explicit decision.

## 8. Frontend implementation details

### State model

Keep the client state small and explicit:

```ts
type LoadState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "success"; data: DeploymentsResponse }
  | { status: "error"; message: string; previous?: DeploymentsResponse };
```

The polling loop must:

- Avoid overlapping requests.
- Preserve the last successful result while a refresh is in progress.
- Stop or back off after repeated failures.
- Clean up timers when the page is unmounted.
- Reset immediately when the user changes the interval or pauses polling.

### Visual language

Use status text plus compact visual indicators:

- Active: prominent warning/in-progress treatment.
- Queued: waiting treatment.
- Success: subdued positive treatment.
- Failure: prominent error treatment.
- Canceled: neutral treatment.

Avoid flashing the entire page on every poll. Update only changed content and show a small “updated” timestamp.

### Accessibility

- Use semantic headings, tables or list structures, and buttons.
- Ensure badges have text labels.
- Provide keyboard access to all controls and links.
- Announce meaningful refresh errors with an appropriate live region.
- Meet a practical WCAG AA contrast target.
- Do not rely on hover alone to reveal deployment information.

## 9. Testing strategy

### Unit tests

Cover:

- Cloudflare response normalization.
- Stage/status mapping.
- Active deployment detection.
- Summary count calculation.
- Sorting and filtering.
- Missing optional fields.
- API error classification.
- Retry/backoff behavior.

### API tests

Mock the Cloudflare API and verify:

- Projects are paginated correctly.
- Deployment requests use the expected account and project identifiers.
- Requests are bounded in concurrency.
- A single project failure becomes a warning rather than a total response failure.
- 401/403 responses do not retry.
- 429/5xx responses retry within limits.
- Tokens are never included in logs or returned payloads.

### Browser tests

Verify:

- Initial loading state.
- Active/queued/success/failure/canceled rendering.
- Manual refresh.
- Pause/resume behavior.
- Automatic polling without overlapping requests.
- Partial failure display.
- Empty state.
- Keyboard navigation and accessible names.

### Manual verification

- Run locally with a test or read-only account token.
- Compare displayed project and deployment data with the Cloudflare dashboard.
- Trigger or observe a real Pages deployment and confirm stage transitions are visible.
- Verify the production bundle contains no token or account secret.
- Verify the deployed endpoint is inaccessible without the chosen access layer.

## 10. Delivery milestones

### Milestone 0 — Confirm API behavior

- Capture representative project and deployment payloads from the target account.
- Confirm pagination, field names, deployment ordering, and URL fields.
- Decide whether the first view needs one deployment or a short history per project.

### Milestone 1 — Scaffold the tracker

- Create the dedicated repository.
- Add TypeScript, React, Vite, Pages Functions, linting, formatting, and test tooling.
- Add `wrangler.jsonc`, `.dev.vars.example`, and safe ignore rules.
- Render a static dashboard shell.

### Milestone 2 — Implement the server-side API proxy

- Add configuration validation.
- Implement project listing and per-project deployment fetching.
- Add normalization, bounded concurrency, timeouts, retries, and warnings.
- Add mocked API tests.

### Milestone 3 — Implement the dashboard

- Add summary counts and project cards/table.
- Add stage/status presentation, links, timestamps, filters, and search.
- Add manual refresh and polling controls.
- Add loading, empty, partial failure, and total failure states.

### Milestone 4 — Harden and verify

- Add browser tests and accessibility checks.
- Review token handling and production access protection.
- Test against real representative deployments.
- Document local setup, deployment, token scope, and troubleshooting.

### Milestone 5 — Deploy

- Create/configure the Cloudflare Pages project.
- Configure production secrets outside source control.
- Deploy the dashboard.
- Apply Cloudflare Access or the selected private access mechanism.
- Record the production URL and rollback procedure in `README.md`.

## 11. Definition of done

- The dashboard lists all accessible Pages projects or clearly reports project-level failures.
- Running deployments are identifiable by status and stage.
- Refreshing does not expose credentials or create overlapping request storms.
- The Cloudflare token exists only in server-side secret configuration.
- The UI handles loading, empty, partial failure, authentication failure, rate limiting, and API outage states.
- Automated tests cover normalization, polling, error handling, and the primary UI states.
- The project can be run locally from a clean checkout using documented commands.
- The production deployment is protected and its URL is documented.

## 12. Explicitly deferred from v1

- Triggering new deployments.
- Canceling, retrying, or deleting deployments.
- Deployment history persistence.
- Notifications through ntfy, Slack, email, or webhooks.
- Multi-account support.
- User-specific Cloudflare OAuth.
- Historical charts and build-duration analytics.
- GitHub commit/PR enrichment.

## 13. Handoff checklist

Before implementation begins, the next agent should receive or confirm:

- Target Cloudflare account ID.
- Name of the dedicated GitHub repository.
- Preferred frontend framework if React/Vite is not desired.
- Whether the dashboard is private to one user or shared with a team.
- Cloudflare Access decision.
- Desired polling interval.
- Whether to display only the latest deployment or a short recent history.
- Representative API payloads, with secrets removed.
- Production hostname, if one already exists.
