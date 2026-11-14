# Security & data handling

This product inspects how an organisation shares data, so it must itself be beyond reproach.

## Principles

| Principle                  | How it is implemented                                                                                                                                                                                                                               |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Read-only**              | Only `*.Read.All` application permissions are requested. No Graph call writes or changes anything.                                                                                                                                                  |
| **Metadata only**          | We store names, dates, sharing settings, labels and usage dates. File contents, emails, chats and Copilot prompts/responses are never requested or stored. Connectors are reviewed against this rule (see `AGENTS.md`).                             |
| **Minimisation**           | Of all items in a library, only those that are shared or have sensitive-looking names are kept. Permissions are only read for shared items.                                                                                                         |
| **Least privilege**        | Each permission is justified in `packages/connectors/src/microsoft-graph/permissions.ts` (rendered in-app and in `PILOT_SETUP.md`). Optional permissions can be withheld; the connector degrades gracefully.                                        |
| **Secrets outside the DB** | Connector secrets are read from environment variables (`GRAPH_CLIENT_SECRET`, …) at runtime; the database only holds non-secret config and cursors. `.env` is git-ignored; use a secret store (Azure Key Vault, AWS Secrets Manager) in production. |
| **Tenant isolation**       | Every row has `tenantId`; every query takes it from the signed-in session.                                                                                                                                                                          |
| **Defence in depth**       | Role checks in middleware and again in each page/server action; security headers (`X-Frame-Options: DENY`, `nosniff`, referrer policy); non-root container user.                                                                                    |
| **Auditability**           | Every analysis run stores the assumptions used; sync runs record stats/warnings/errors.                                                                                                                                                             |

## Personal data

Usage data is per person (needed for licence reclamation and team coaching). Managers only see
their own department. If the client prefers, keep Microsoft 365 report concealment ON — the app then
shows aggregate Copilot data only (see `PILOT_SETUP.md` step 6). Document the lawful basis
(e.g. legitimate interest for IT security/licence management) in the pilot agreement and, for NZ
clients, align with the Privacy Act 2020 (IPP 1–4, 5 and 11).

## Pilot hygiene checklist

- Client secret with ≤ 6-month expiry; delete the app registration at the end of the pilot.
- Consider Conditional Access for workload identities to restrict the app to your hosting IPs.
- Rotate `NEXTAUTH_SECRET` and use Entra SSO for client users in production.
- Encrypt Postgres at rest (managed Postgres does by default) and restrict network access.
