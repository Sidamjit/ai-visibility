# Lumen AI Insight (working name)

**AI visibility & value platform.** Connects to an organisation's AI estate and its content
platforms, then shows IT, executives and managers:

- **Exposure & risk** — oversharing (anyone / org-wide links, guests, public sites, broken
  inheritance, stale content), unlabelled sensitive content, dormant access, and a per-site
  **Copilot readiness** score.
- **Spend & waste** — paid seats vs. active use, cost per active user, consumption costs.
- **Value** — estimated hours and money saved, with **editable, visible assumptions**.
- **Recommendations** — every finding comes with concrete, ordered fix steps, a remediation
  checklist for IT, and training suggestions for managers.

> The product name is a placeholder defined once in [`packages/core/src/brand.ts`](packages/core/src/brand.ts)
> (or via `NEXT_PUBLIC_PRODUCT_NAME` / `NEXT_PUBLIC_VENDOR_NAME`), so it can be rebranded or white-labelled.

| Executive                                                 | ICT                                           | Manager                                               |
| --------------------------------------------------------- | --------------------------------------------- | ----------------------------------------------------- |
| ![Executive](docs/screenshots/01-executive-dashboard.png) | ![ICT](docs/screenshots/02-ict-dashboard.png) | ![Manager](docs/screenshots/05-manager-dashboard.png) |

More: [site drill-down](docs/screenshots/03-ict-site-drilldown.png) ·
[remediation checklist](docs/screenshots/04-ict-remediation-checklist.png) ·
[recommendations](docs/screenshots/06-recommendations.png) · [report](docs/screenshots/07-report.png)
([sample PDF](docs/screenshots/sample-report.pdf)) · [connectors](docs/screenshots/08-connectors.png) ·
[assumptions](docs/screenshots/09-assumptions.png)

## Pilot scope (v0.1)

| Source                                                                                                                         | Status                                                             |
| ------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------ |
| Microsoft 365 — SharePoint / OneDrive exposure, sensitivity labels, M365 Copilot usage & licences (Microsoft Graph, read-only) | **Available**                                                      |
| Demo organisation (synthetic data, no credentials)                                                                             | **Available**                                                      |
| ChatGPT Enterprise, Claude (Anthropic), Google Gemini, custom AI / LMS via webhook & OpenTelemetry                             | Planned (interface + TODO docs in `packages/connectors/src/stubs`) |

## Quick start

### Option A — Docker Compose (Postgres, recommended)

```bash
cp .env.example .env
# set NEXTAUTH_SECRET (openssl rand -base64 32)
docker compose up --build
```

Open http://localhost:3000 and sign in with a demo account (password `demo1234`, or `DEMO_PASSWORD`):

| Email                | Role              | Lands on                                  |
| -------------------- | ----------------- | ----------------------------------------- |
| `it@demo.local`      | IT / ICT          | ICT dashboard (everything)                |
| `exec@demo.local`    | Executive         | Executive overview, report, manager views |
| `manager@demo.local` | Manager (Finance) | Team adoption, recommendations            |

### Option B — local Node (no Docker)

Requires Node 22+.

```bash
npm install
cp .env.example .env
# For SQLite (zero setup) set an ABSOLUTE path, e.g.:
#   DATABASE_URL="file:$PWD/packages/db/prisma/dev.db"
# or point DATABASE_URL at any Postgres.
npm run db:generate      # picks provider from DATABASE_URL (postgresql:// or file:)
npm run db:push          # create tables
npm run db:seed          # demo tenant + 8 weeks of simulated trend history
npm run dev              # http://localhost:3000
```

> Switching between SQLite and Postgres? Re-run `npm run db:generate` after changing `DATABASE_URL`.

### Everyday commands

```bash
npm run lint         # ESLint (whole monorepo)
npm run typecheck    # tsc --noEmit in every workspace
npm test             # Vitest unit tests (rules, Graph parsing, throttling, demo data)
npm run build        # Next.js production build
npm run worker -- sync-all              # sync every connector + re-analyse
npm run screenshots  # BASE_URL=... CHROME_PATH=... — refresh docs/screenshots
```

## Running a real pilot

See **[docs/PILOT_SETUP.md](docs/PILOT_SETUP.md)** — a step-by-step guide for the client's IT admin to create a
read-only Entra app registration, plus the commands to onboard the tenant:

```bash
npm run worker -- create-tenant --name "Client Ltd" --slug client --admin-email it@client.com --admin-password '<12+ chars>'
npm run worker -- check --tenant client     # verifies credentials & permissions
npm run worker -- sync --tenant client      # first sync + analysis
```

## Repository layout

```
apps/
  web/            Next.js (App Router) UI, auth, server actions, API routes
  worker/         CLI + scheduler: seed, onboard tenants, sync, analyse
packages/
  core/           brand, roles, normalized domain model (zod), assumptions, sensitivity heuristics
  connectors/     Connector interface + Microsoft Graph, demo, planned stubs
  analysis/       Rule engine, 14 documented rules, scoring (pure, deterministic)
  db/             Prisma schema (Postgres / SQLite), persistence helpers
  pipeline/       Orchestration used by worker + web: sync → persist → analyse → store
docs/             Architecture, pilot setup, extension guides, security, screenshots
```

## Documentation

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — design, data flow, decisions
- [docs/PILOT_SETUP.md](docs/PILOT_SETUP.md) — client IT admin guide (Entra app registration, permissions)
- [docs/SECURITY.md](docs/SECURITY.md) — data minimisation, least privilege, secrets, tenancy
- [docs/ADDING_A_CONNECTOR.md](docs/ADDING_A_CONNECTOR.md)
- [docs/ADDING_AN_ANALYSIS_RULE.md](docs/ADDING_AN_ANALYSIS_RULE.md)
- [AGENTS.md](AGENTS.md) — conventions for AI coding assistants (and humans)

## Deployment options

Web-first, multi-tenant SaaS (one deployment, many customer tenants, `tenantId` on every row).
Because the UI, worker and data layer are standard Node + Postgres, the same code can later ship as a
**single-tenant / on-premises** Docker deployment inside a client's own Azure subscription, or be
wrapped as a **desktop app** (e.g. Tauri/Electron around the web UI) if a client requires it —
no rewrite needed.

## Known gaps (v0.1)

See the "Roadmap / known gaps" section of [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md#roadmap--known-gaps).
