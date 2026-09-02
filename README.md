# Cloudflare Pages Deploy Tracker

A read-only React dashboard for the latest Cloudflare Pages deployment state across one account. The browser talks to `/api/deployments`; the Pages Function keeps the Cloudflare API token server-side and returns only normalized dashboard fields.

## Local setup

Requirements: Node.js 20+ and pnpm.

```sh
pnpm install
cp .env.example .env
```

Fill `.env` with the two values shown in `.env.example`. The API token must have the Cloudflare `Pages Read` permission for that account. `.env` is ignored and must never be committed. Wrangler also supports the existing `.dev.vars` file for local overrides.

To open this repository and its local environment file in VS Code:

```sh
code /Users/alex/Atlesque/Tools/cloudflare-pages-deploy-tracker /Users/alex/Atlesque/Tools/cloudflare-pages-deploy-tracker/.env
```

To run the full Pages application locally:

```sh
pnpm build
pnpm pages:dev
```

Wrangler will serve the built frontend and the `/api/deployments` Function. For frontend-only work, `pnpm dev` starts Vite, but the API will not be available unless it is proxied from a running Pages development server.

## Commands

| Command | Purpose |
| --- | --- |
| `pnpm dev` | Start the Vite frontend server |
| `pnpm build` | Type-check and build the frontend |
| `pnpm test` | Run unit, API-client, and dashboard tests |
| `pnpm typecheck` | Check all TypeScript projects |
| `pnpm pages:dev` | Serve `dist` with Pages Functions locally |
| `pnpm pages:deploy` | Deploy `dist` to the configured Pages project |

## Configuration and deployment

The checked-in `wrangler.jsonc` is the Pages configuration source of truth. Set the production secrets outside source control:

```sh
pnpm wrangler secret put CLOUDFLARE_ACCOUNT_ID
pnpm wrangler secret put CLOUDFLARE_API_TOKEN
```

The API token should be narrowly scoped to the target account with `Pages Read`. Rotate it by creating a replacement token, updating the secret, verifying the dashboard, and then revoking the old token. Protect the deployed dashboard with Cloudflare Access or an equivalent private access layer before sharing its URL.

## API behavior

`GET /api/deployments?page=1` returns one page of 10 accessible Pages projects, includes the account-wide project total and page metadata, and fetches a recent deployment page for each project with a concurrency limit of six. Transient 429 and 5xx responses retry with bounded exponential backoff; authentication, authorization, validation, and not-found errors do not retry. A failed project becomes a project-level warning while other projects remain visible.

The endpoint does not trigger, cancel, retry, delete, or modify deployments. No D1, KV, R2, or other persistence is used in v1. The client keeps its latest successful result in memory and polls every 10 seconds by default, with pause, manual refresh, interval, status filter, and search controls.

## Troubleshooting

- `Cloudflare rejected the API token`: verify the token is active, targets the configured account, and includes `Pages Read`.
- `Cloudflare denied access`: check the account ID and token scope.
- Rate-limit warnings: leave polling paused or increase the interval, then refresh after the limit clears.
- Local API errors: run `pnpm build` before `pnpm pages:dev`; Wrangler reads `.env` or `.dev.vars` from the project root.

## Verification

The project includes normalization and sorting tests, pagination/retry/concurrency tests, and dashboard loading/status/filter/pause tests. Before production use, compare the normalized results against the Cloudflare dashboard, verify the production bundle contains no secret values, and confirm the deployed hostname is protected by the selected access layer.
