# AGENTS.md — conventions for AI coding assistants (and humans)

You are working on an **AI visibility & value platform** (working name "Lumen AI Insight").
Read `README.md` and `docs/ARCHITECTURE.md` first.

## Golden rules

1. **Read-only; content never persisted.** Never call a write endpoint on a customer system. File
   content may be read ONLY through `ContentScannerPort` (in memory, size-capped) and must never be
   written to the database, disk, logs, error messages, fixtures or telemetry — persist only
   `ContentScan` (detector ids, counts, hashes, redacted snippets). Never add code that reads emails,
   chats or AI prompts/responses, and never call a vendor-hosted AI API (LLMs go through
   `@aiv/content-scan` `llm/guard.ts`).
2. **Secrets only from environment variables** (`ConnectorContext.secrets`). Never store secrets in the
   database, logs, fixtures or commits.
3. **Every query is tenant-scoped.** Take `tenantId` from the session (`requireUser/requireRole`),
   never from request params.
4. **Product name lives in one place**: `packages/core/src/brand.ts`. Never hard-code it.
5. **No magic numbers in rules.** Thresholds and money assumptions go in
   `packages/core/src/assumptions.ts` with a label + help text; handling rules come from the tenant's
   policy (`@aiv/policy`).
6. **The vendor has no access by default.** New pages must call `requireRole` (audit + vendor
   scope); mutations must use `requireRole(roles, WRITE)`. Never add phone-home calls; telemetry is
   opt-in only (`packages/pipeline/src/telemetry.ts`).

## Where things go

| Task                 | Location                                                                                                                                   | Guide                             |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------- |
| New data source      | `packages/connectors/src/<source>/` + registry                                                                                             | `docs/ADDING_A_CONNECTOR.md`      |
| New finding / check  | `packages/analysis/src/rules/<area>-<nnn>-<slug>.ts` + `rules/index.ts`                                                                    | `docs/ADDING_AN_ANALYSIS_RULE.md` |
| New normalized field | `packages/core/src/model.ts` → `packages/db/prisma/schema.prisma` → `packages/db/src/entities.ts` (save + load)                            | —                                 |
| New page             | `apps/web/app/(app)/<route>/page.tsx`; add route roles to `ROUTE_ACCESS` in `packages/core/src/roles.ts` and nav in `app/(app)/layout.tsx` | —                                 |
| Mutations            | Server actions in `apps/web/app/(app)/actions.ts` (re-check role!)                                                                         | —                                 |
| Orchestration        | `packages/pipeline` (shared by web + worker)                                                                                               | —                                 |
| New detector         | `packages/content-scan/src/classifiers/builtin.ts` (+ validator in `validators.ts`, tests with published examples)                         | `docs/POLICY_GUIDE.md`            |
| New file format      | `packages/content-scan/src/extract/index.ts` (+ in-memory fixture in `__fixtures__/files.ts`)                                              | —                                 |
| Policy fields        | `packages/policy/src/schema.ts` → `evaluate.ts` → regenerate `samples/nz-psr-sample.yaml`                                                  | `docs/POLICY_GUIDE.md`            |
| Settings mutations   | `apps/web/app/(app)/settings/actions.ts` (`WRITE`)                                                                                         | —                                 |

## Code style

- TypeScript strict (`noUncheckedIndexedAccess` on). No `any`; prefer `unknown` + zod.
- Pure functions for parsing and analysis; I/O only in connectors' `sync`, `pipeline`, and pages.
- Each file starts with a JSDoc block saying **what it is and why it exists**. Comment intent,
  not mechanics.
- Imports between packages go through the package entry (`@aiv/core`), never deep paths.
- Prettier formats (`npm run format`), ESLint lints (`npm run lint`). Don't fight them.
- Recharts: axes/series must be **direct children** of the chart (no fragments).
- Prisma schema stays portable (Postgres + SQLite): no enums, no scalar lists, no `@db.*`.

## Before you finish

```bash
npm run lint && npm run typecheck && npm test && npm run build
```

- Add/adjust tests next to the code (`*.test.ts`). Rules need positive + negative cases; connectors
  need parser tests with fixtures and a mocked-fetch sync test.
- If you changed what the Graph connector requests, update `permissions.ts` **and**
  `docs/PILOT_SETUP.md` (they must match).
- If UI changed visibly, refresh screenshots: run the app with the demo seed, then
  `BASE_URL=http://localhost:3000 npm run screenshots`.

## Useful facts

- Demo data: `npm run db:seed` (deterministic; seed 42). Demo users `it@ / exec@ / manager@demo.local`,
  password `demo1234`.
- `DATABASE_URL` decides the Prisma provider (`file:` → SQLite, `postgresql://` → Postgres); re-run
  `npm run db:generate` after switching.
- Finding IDs are `ruleId:key` and must stay stable (remediation ticks are keyed on them).
- The demo tenant uses the NZ sample policy with `snippetMode: 'redacted'`; demo content scans are
  synthetic counts (there are no demo files).
