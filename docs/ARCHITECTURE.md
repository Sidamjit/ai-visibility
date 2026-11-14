# Architecture

## Goals that shaped the design

1. **Connect to many AI and content sources** without touching dashboards or rules each time.
2. **Explainable output** — every score, finding and dollar figure can be traced to evidence and
   editable assumptions. Executives must be able to ask "why?" and get an answer.
3. **Safe by default** — read-only, metadata-only, least-privilege, secrets outside the database.
4. **Easy for humans and AI assistants to extend** — small modules with one job, strict types,
   documented contracts, tests next to code.

## Data flow

```
 ┌──────────────┐    sync(cursor)     ┌──────────────────┐   saveBatch()   ┌──────────────┐
 │  Connector    │ ──────────────────▶ │ NormalizedBatch   │ ─────────────▶ │  Postgres     │
 │ (Graph, demo, │   read-only API     │ (@aiv/core model) │                │ (Prisma)      │
 │  ChatGPT...)  │                     └──────────────────┘                └──────┬───────┘
 └──────────────┘                                                                 │ loadBatch()
                                                                                  ▼
 ┌──────────────┐   reads latest run   ┌──────────────────┐  runAnalysis()  ┌──────────────┐
 │  Web (Next)   │ ◀────────────────── │ AnalysisRun +     │ ◀───────────── │ Rule engine   │
 │ dashboards    │                     │ Findings + Recs   │                │ (@aiv/analysis│
 └──────────────┘                      └──────────────────┘                └──────────────┘
```

- **Worker** (`apps/worker`) runs `sync → persist → analyse` on a schedule (`SYNC_INTERVAL_MINUTES`)
  and hosts the onboarding CLI. The **web app** can trigger the same pipeline ("Sync now",
  "Re-run analysis", saving assumptions) through `@aiv/pipeline`.
- The analysis engine is **pure**: `runAnalysis(batch, { assumptions, asOf })` has no I/O and no clock
  access, so it is deterministic and trivially unit-testable.
- Each analysis creates an immutable `AnalysisRun` with its findings, recommendations, site scores,
  department stats and the exact assumptions used → historical trends and auditability.

## Packages

| Package           | Responsibility                                                                                     | Depends on             |
| ----------------- | -------------------------------------------------------------------------------------------------- | ---------------------- |
| `@aiv/core`       | Brand constant, roles/route access, normalized model (zod), assumptions, sensitivity heuristics    | zod                    |
| `@aiv/connectors` | `Connector` interface, registry, Microsoft Graph client + connector, demo generator, planned stubs | core                   |
| `@aiv/analysis`   | Index/helpers, 14 rules, metrics & value model, readiness/risk/value scoring                       | core                   |
| `@aiv/db`         | Prisma schema, client singleton, `saveBatch` / `loadBatch` / `deleteTenant`                        | core, Prisma           |
| `@aiv/pipeline`   | `runConnectorSync`, `runTenantAnalysis`, demo seed, tenant onboarding                              | all of the above       |
| `apps/web`        | Next.js App Router UI, NextAuth, server actions, CSV export, printable report                      | pipeline, analysis, db |
| `apps/worker`     | CLI + scheduler                                                                                    | pipeline               |

Workspace packages export **TypeScript source** (no build step); Next transpiles them
(`transpilePackages`) and the worker runs through `tsx`.

## Normalized model

Defined once in `packages/core/src/model.ts` and mirrored in `packages/db/prisma/schema.prisma`:

`Department`, `Identity` (users & guests), `AIAsset` (Copilot, agents, custom AI), `Licence`,
`UsageSummary` (per user/asset/period, per-feature last activity), `ContentLocation`
(site/team/library/folder/file/OneDrive), `SharingGrant` (anyone / organization / specific-people /
direct / external-guest, inherited flag), `SensitivityLabel`, `CostItem`.
Analysis outputs: `AnalysisRun`, `Finding`, `Recommendation`, `ValueMetric`; plus `RemediationTask`
(checklist ticks keyed by stable `findingKey`, so they survive re-analysis).

Every table has `tenantId`. Entity rows also carry `connectorInstanceId` so several sources can feed
one tenant and each can be re-synced independently.

## Scoring (explainable)

- **Copilot readiness per site** (0–100, higher = safer): deductions for anyone links (esp. on
  sensitive items), sensitive content on public/huge sites, org-wide links on sensitive items, guests,
  unlabelled sensitive items, staleness, membership size, broken inheritance. Each deduction is shown
  in the site drill-down. Defined in `packages/analysis/src/scoring.ts`.
- **Risk score** (0–100, higher = worse): exposure 40%, labelling 20%, readiness 20%, severity
  density 10%, licence waste 10%.
- **Value score** (0–100): adoption 40%, feature breadth 20%, value÷spend 40% (saturating at 3×).
- **Value model**: hours saved per user per week by usage intensity (light/regular/power) ×
  4.33 × loaded hourly cost × confidence factor. All inputs are tenant-editable assumptions.

## Microsoft Graph connector

`packages/connectors/src/microsoft-graph/` — dependency-free HTTP client (`client.ts`), pure parsers
(`parsers.ts`), permission list (`permissions.ts`), orchestration (`connector.ts`).

- App-only OAuth2 client-credentials; token cached and refreshed once on 401.
- Paging via `@odata.nextLink`; throttling honours `Retry-After` on 429/503/504 with exponential
  fallback (max 6 retries); per-tenant concurrency limit (default 4).
- **Incremental sync**: one `@odata.deltaLink` per document library stored in the connector cursor;
  later runs fetch only changed items and handle deletions.
- **Data minimisation**: only items that are _shared_ or have _sensitive-looking names/paths_ are kept;
  permissions are only requested for shared items; file content is never requested.
- Optional permissions degrade gracefully (warnings on the Connectors page).

## Auth & tenancy

NextAuth v4 with JWT sessions (8 h). Credentials provider (bcrypt hashes in `AppUser`) and optional
Microsoft Entra ID SSO (only pre-provisioned users). Role (`IT`, `EXECUTIVE`, `MANAGER`) and
`tenantId` are JWT claims. Route access is declared once (`ROUTE_ACCESS` in `@aiv/core`) and enforced
in `middleware.ts` **and** again server-side in each page via `requireRole()`. Every query takes
`tenantId` from the session, never from the URL.

## Database portability

Postgres in production; SQLite for zero-setup local dev. The schema avoids enums, scalar lists and
native types so one schema works for both; `packages/db/scripts/prisma.mjs` rewrites the provider
from `DATABASE_URL`. Pilot uses `prisma db push`; move to `prisma migrate` before multi-customer
production.

## Deployment

`Dockerfile` builds two targets: `web` (Next standalone server, non-root user, health check) and
`worker`. `docker-compose.yml` runs Postgres + one-shot `setup` (schema push + optional demo seed) +
web + worker. The same images run in Azure Container Apps / App Service, AWS ECS, or on-prem.

Future desktop / on-prem: package the same containers for a client's own subscription (single-tenant),
or wrap the web UI in Tauri/Electron. Nothing in the code assumes multi-tenant SaaS hosting.

## Roadmap / known gaps

- **Connectors**: ChatGPT Enterprise, Claude, Gemini and custom/OTel ingestion are interface + TODO
  only. Microsoft Purview audit log (Copilot interaction events), Copilot Studio agent inventory,
  Entra sign-in risk and Defender for Cloud Apps (shadow AI discovery) are natural next Microsoft sources.
- **Graph coverage**: site-level "Everyone except external users" grants and SharePoint sharing
  settings need the SharePoint REST/Admin API (not Graph). File-level sensitivity labels need
  `extractSensitivityLabels`, which requires write-level permission, so v0.1 uses site/group labels +
  name heuristics. Licence assignment dates are not exposed on `/users`.
- **Sensitive-content detection is metadata-based** (names/paths/labels). Integrating Purview
  DLP/content explorer results would replace heuristics with real classifications.
- **Scale**: syncs run in-process; very large tenants (>1M items) should move to a queue (e.g. BullMQ
  / Azure Service Bus) with per-site jobs and checkpointing.
- **Auth**: client-certificate auth for Graph (recommended over secrets) and a secrets manager
  (Azure Key Vault) integration; user management UI; MFA for credentials users (use Entra SSO).
- **Migrations**: switch from `db push` to versioned Prisma migrations.
- **UI**: no end-to-end tests yet (Playwright), no in-app connector creation wizard (CLI only).
