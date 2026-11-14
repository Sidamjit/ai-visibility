# Architecture

## Goals that shaped the design

1. **Connect to many AI and content sources** without touching dashboards or rules each time.
2. **Explainable output** — every score, finding and dollar figure can be traced to evidence and
   editable assumptions. Executives must be able to ask "why?" and get an answer.
3. **Safe by default** — read-only, least-privilege, secrets outside the database, and **client-hosted**:
   file content is read in memory inside the client's environment and never stored; the vendor has
   no access unless the client grants it ([VENDOR_ACCESS.md](VENDOR_ACCESS.md)).
4. **The client's own rules** — content is judged against the organisation's classification and
   handling policy (editable YAML, [POLICY_GUIDE.md](POLICY_GUIDE.md)), not a vendor's opinion.
5. **Easy for humans and AI assistants to extend** — small modules with one job, strict types,
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

### Content scanning and policy evaluation

```
 Graph delta ──▶ connector keeps shared / sensitive-named / content-classified items
                     │  file changed (cTag) and on allow list and ≤ size limit?
                     ▼
              ContentScannerPort.scan()  (@aiv/content-scan, injected by @aiv/pipeline)
                bytes in memory → extractText (docx/xlsx/pptx/pdf/txt/csv/md/eml/msg/html)
                → classifyText (validated detectors + custom) → [optional client LLM]
                → ContentScan { hits: [{classifierId, count, distinctValues, confidence, snippets?}] }
                     │  bytes zero-filled; text dropped
                     ▼
              saveBatch() upserts ContentScan rows (survive full syncs; orphans pruned)
                     ▼
 runAnalysis(batch, { policy })  (@aiv/analysis + @aiv/policy, pure)
   classifyScan(scan, policy)  → level (highest matching content rule; LLM may only raise)
   ExposureFacts(file)         → anyone/org links, guests, public site, audience, label, site, age
   evaluateHandling(level, facts) → breaches (sharing, audience, label, location, retention)
   → POL-001..005, SEC-001 findings + ContentMetrics + ClassifiedFileView[] (content-free)
```

- Classification happens at **analysis** time, so editing the policy re-evaluates every file without
  re-reading any content.
- The scanner port (`ContentScannerPort`) lives in `@aiv/core`, so connectors do not depend on the
  extraction libraries and can be tested with a fake scanner.
- Without a tenant policy, the NZ sample policy (`@aiv/policy`) is used.

### Pipeline

- **Worker** (`apps/worker`) runs `sync → persist → analyse` on a schedule (`SYNC_INTERVAL_MINUTES`)
  and hosts the onboarding CLI. The **web app** can trigger the same pipeline ("Sync now",
  "Re-run analysis", saving assumptions) through `@aiv/pipeline`.
- The analysis engine is **pure**: `runAnalysis(batch, { assumptions, asOf })` has no I/O and no clock
  access, so it is deterministic and trivially unit-testable.
- Each analysis creates an immutable `AnalysisRun` with its findings, recommendations, site scores,
  department stats and the exact assumptions used → historical trends and auditability.

## Packages

| Package             | Responsibility                                                                                                                                | Depends on                                          |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| `@aiv/core`         | Brand constant, roles/route access (incl. vendor scopes), normalized model (zod), content-scan types, assumptions                             | zod                                                 |
| `@aiv/policy`       | Policy schema (levels, content rules, custom detectors), YAML import/export, classification, handling evaluation, NZ sample, document → draft | core, yaml                                          |
| `@aiv/content-scan` | Validators (IRD, bank, NHI, TFN, Luhn), 12 detectors, text extraction, redaction, scanner, client-only LLM adapter                            | core, policy, fflate, unpdf, postal-mime, msgreader |
| `@aiv/connectors`   | `Connector` interface, registry, Microsoft Graph client + connector, demo generator, planned stubs                                            | core                                                |
| `@aiv/analysis`     | Index/helpers, 20 rules (incl. POL-001..005, SEC-001), content metrics, value model, scoring                                                  | core, policy                                        |
| `@aiv/db`           | Prisma schema, client singleton, `saveBatch` / `loadBatch` / `deleteTenant`                                                                   | core, Prisma                                        |
| `@aiv/pipeline`     | `runConnectorSync` (+ scanner wiring), `runTenantAnalysis`, policy/settings, drafts, audit, vendor grants, opt-in telemetry, seed             | all of the above                                    |
| `apps/web`          | Next.js App Router UI, NextAuth, server actions, CSV export, printable report                                                                 | pipeline, analysis, db                              |
| `apps/worker`       | CLI + scheduler                                                                                                                               | pipeline                                            |

Workspace packages export **TypeScript source** (no build step); Next transpiles them
(`transpilePackages`) and the worker runs through `tsx`.

## Normalized model

Defined once in `packages/core/src/model.ts` and mirrored in `packages/db/prisma/schema.prisma`:

`Department`, `Identity` (users & guests), `AIAsset` (Copilot, agents, custom AI), `Licence`,
`UsageSummary` (per user/asset/period, per-feature last activity), `ContentLocation`
(site/team/library/folder/file/OneDrive), `SharingGrant` (anyone / organization / specific-people /
direct / external-guest, inherited flag), `SensitivityLabel`, `CostItem`.
`ContentScan` (per file: detector hits as counts, sha256, cTag, status — never content).
Analysis outputs: `AnalysisRun` (incl. `content` metrics and `contentFiles`), `Finding`,
`Recommendation`, `ValueMetric`; plus `RemediationTask` (checklist ticks keyed by stable
`findingKey`, so they survive re-analysis). Governance: `Tenant.policy` / `scanSettings` /
`vendorAccessEnabled`, `PolicyDraft`, `AuditEvent`, `VendorAccessGrant`.

Every table has `tenantId`. Entity rows also carry `connectorInstanceId` so several sources can feed
one tenant and each can be re-synced independently.

## Scoring (explainable)

- **Copilot readiness per site** (0–100, higher = safer): deductions for anyone links (esp. on
  sensitive items), sensitive content on public/huge sites, org-wide links on sensitive items, guests,
  unlabelled sensitive items, staleness, membership size, broken inheritance. Each deduction is shown
  in the site drill-down. Defined in `packages/analysis/src/scoring.ts`.
- **Risk score** (0–100, higher = worse): exposure 40%, labelling 20%, readiness 20%, severity
  density 10%, licence waste 10%. When content has been classified: exposure 30%, **policy 20%**
  (share of classified files breaching the policy), labelling 15%, readiness 15%, severity 10%,
  waste 10%.
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
- **Data minimisation**: only items that are _shared_, have _sensitive-looking names/paths_, or whose
  content was classified are kept; permissions are requested for shared or classified items.
- **Content scanning** (when enabled): changed files on the allow list are streamed into memory
  (`GraphClient.getBytes`, size-capped), scanned with bounded concurrency, and the applied label is
  read with `extractSensitivityLabels` (Files.Read.All). A per-run cap defers remaining files without
  advancing that drive's delta link, so nothing is missed.
- Optional permissions degrade gracefully (warnings on the Connectors page).

## Auth & tenancy

NextAuth v4 with JWT sessions (8 h). Credentials provider (bcrypt hashes in `AppUser`) and optional
Microsoft Entra ID SSO (only pre-provisioned users). Role (`IT`, `EXECUTIVE`, `MANAGER`,
`VENDOR_SUPPORT`) and
`tenantId` are JWT claims. Route access is declared once (`ROUTE_ACCESS` in `@aiv/core`) and enforced
in `middleware.ts` **and** again server-side in each page via `requireRole()`. Every query takes
`tenantId` from the session, never from the URL.

`VENDOR_SUPPORT` users can only sign in with an active grant (`VendorAccessGrant`, expiry ≤ 7 days,
scope `diagnostics` or `read-only`) while `Tenant.vendorAccessEnabled` is on. `requireUser()`
re-reads the grant on every request; mutations use `requireRole(roles, WRITE)`, which the vendor never
passes. `requireRole` also writes a `page.view` audit event; exports, logins and settings changes
are audited too.

## Database portability

Postgres in production; SQLite for zero-setup local dev. The schema avoids enums, scalar lists and
native types so one schema works for both; `packages/db/scripts/prisma.mjs` rewrites the provider
from `DATABASE_URL`. Pilot uses `prisma db push`; move to `prisma migrate` before multi-customer
production.

## Deployment

**Client-hosted single-tenant is the primary mode** ([DEPLOYMENT.md](DEPLOYMENT.md)).
`Dockerfile` builds two targets: `web` (Next standalone server, non-root user, health check) and
`worker` (non-root). `docker-compose.yml` runs Postgres + one-shot `setup` (schema push + optional
demo seed) + web + worker (+ optional Ollama profile) on the client's host.
`deploy/azure/main.bicep` deploys the same images into the client's Azure subscription: Container
Apps (internal), PostgreSQL Flexible Server (private access), Key Vault (private endpoint, RBAC) and a
managed identity. No telemetry unless the client opts in.

## Roadmap / known gaps

- **Connectors**: ChatGPT Enterprise, Claude, Gemini and custom/OTel ingestion are interface + TODO
  only. Microsoft Purview audit log (Copilot interaction events), Copilot Studio agent inventory,
  Entra sign-in risk and Defender for Cloud Apps (shadow AI discovery) are natural next Microsoft sources.
- **Graph coverage**: site-level "Everyone except external users" grants and SharePoint sharing
  settings need the SharePoint REST/Admin API (not Graph). File labels are read only for classified
  files (`extractSensitivityLabels`). Licence assignment dates are not exposed on `/users`.
- **Content scanning**: no OCR (scanned images/PDFs without a text layer yield no text); encrypted
  (label/IRM-protected) files cannot be read and are reported as unreadable; `.msg` extraction is
  implemented but not yet tested against real Outlook files; legacy `.doc/.xls/.ppt` are not
  supported. Purview DLP / Content Explorer results are not imported (not available app-only via
  Graph); the app's own detectors are used instead. `Files.Read.All` is tenant-wide; scoping to chosen
  sites with `Sites.Selected` is a planned option.
- **Vendor access**: in-app only; infrastructure access (exec, DB) is governed by the client's own
  PIM/processes.
- **Scale**: syncs run in-process; very large tenants (>1M items) should move to a queue (e.g. BullMQ
  / Azure Service Bus) with per-site jobs and checkpointing.
- **Auth**: client-certificate auth for Graph (recommended over secrets) and a secrets manager
  (Azure Key Vault) integration; user management UI; MFA for credentials users (use Entra SSO).
- **Migrations**: switch from `db push` to versioned Prisma migrations.
- **UI**: no end-to-end tests yet (Playwright), no in-app connector creation wizard (CLI only).
