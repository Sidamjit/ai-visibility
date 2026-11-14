# Security & data handling

This product reads an organisation's files to find information that is stored or shared in breach of
its own policy. That only works if the client can trust it completely, so the design rule is:

> **Everything runs inside the client's environment. File content never leaves it and is never
> stored. The vendor (app creator) cannot see the client's content, findings or data unless the
> client explicitly grants a time-boxed, audited support login.**

## Principles

| Principle                        | How it is implemented                                                                                                                                                                                                                                                            |
| -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Client-hosted, single-tenant** | Primary deployment is Docker Compose on the client's server or the Bicep template in the client's own Azure subscription ([DEPLOYMENT.md](DEPLOYMENT.md)). The vendor has no account, key, VPN or telemetry channel into it by default.                                          |
| **Read-only**                    | Only `*.Read.All` application permissions. No Graph call writes or changes anything (labels are read, never applied).                                                                                                                                                            |
| **Content in memory only**       | The worker downloads a file into memory (size-capped stream), extracts text, classifies it and zero-fills the buffer. Bytes and text are never written to disk, the database, logs or error messages. See [Content handling](#content-handling).                                 |
| **Store findings, not content**  | Persisted per file: detector ids, match counts, distinct-value counts (via a per-process HMAC key that is never stored), confidence, SHA-256 of the file, the Graph `cTag`, and — only if the client turns it on — short **redacted** snippets. Default snippet mode is **off**. |
| **LLM off by default**           | Optional LLM classification/policy drafting only accepts endpoints the client controls (their Azure OpenAI resource or a model server on their network). Vendor-hosted public AI APIs are refused in code. See [LLM classification](#llm-classification).                        |
| **No phone-home**                | No telemetry unless `TELEMETRY_ENABLED=true` **and** `TELEMETRY_ENDPOINT` are set by the client. If enabled: anonymised, bucketed counts only; each payload is written to the audit log. See [Telemetry](#telemetry).                                                            |
| **Zero vendor access**           | `VENDOR_SUPPORT` role exists but cannot sign in unless the client switches vendor access on **and** issues a grant with an expiry (max 7 days). Checked on every request; revocation is immediate. See [VENDOR_ACCESS.md](VENDOR_ACCESS.md).                                     |
| **Audit log**                    | Sign-ins (and failures), every page view, CSV/report exports, policy and settings changes, vendor grants/revocations/sign-ins, LLM use and telemetry sends are recorded in `AuditEvent` (Settings → Audit log).                                                                  |
| **Least privilege**              | Each Graph permission is justified in `packages/connectors/src/microsoft-graph/permissions.ts` (rendered in-app and in `PILOT_SETUP.md`). Optional permissions can be withheld; the connector degrades gracefully.                                                               |
| **Secrets outside the DB**       | Secrets come from environment variables (Compose `.env`) or Key Vault references (Azure). The database holds only non-secret config and cursors.                                                                                                                                 |
| **Tenant isolation**             | Every row has `tenantId`; every query takes it from the signed-in session.                                                                                                                                                                                                       |
| **Defence in depth**             | Role checks in middleware and again in each page/server action (`requireRole`, `WRITE` for mutations); security headers; non-root containers; Postgres and Key Vault on private networking in the Azure template; CSV exports neutralise spreadsheet formulas.                   |

## Content handling

```
Graph  ──(TLS, streamed, size-capped)──▶  worker memory  ──▶  text extraction  ──▶  detectors
                                               │                                         │
                                               └── zero-filled after scan ◀──────────────┘
                                                                                         ▼
                                    database: { classifierId, count, distinctValues, confidence,
                                                sha256, cTag, [redacted snippets if enabled] }
```

- **What is read**: files in SharePoint/OneDrive document libraries whose extension is on the
  allow list (docx, xlsx, pptx, pdf, txt, csv, md, eml, msg, html… — Settings → Content scanning)
  and under the size limit (default 25 MB). Mailboxes, Teams chats and Copilot prompts/responses are
  never read.
- **Incremental**: unchanged files (same `cTag`) are not downloaded again. A per-run cap
  (`maxFilesPerRun`) spreads the first scan of large tenants over several syncs.
- **Limits**: concurrency limit (default 4), Graph throttling honoured (`Retry-After`), zip-bomb
  guard for Office files (max uncompressed size), text cap per file (default 2 M characters).
- **Unreadable files**: encrypted (sensitivity-label/IRM-protected) or corrupt files are recorded as
  `failed` with a reason; files over the size limit or off the allow list as `skipped`. Their
  metadata, sharing and label are still analysed.
- **Snippets** (`snippetMode`):
  - `off` (default) — nothing but counts.
  - `redacted` — up to `maxSnippetsPerClassifier` (default 2) short windows of
    `snippetContextChars` (default 20) characters around a match. The match itself, any neighbouring
    matches, every run of 3+ digits and every email address are masked (`•••`). Intended so a reviewer
    can see _why_ something matched ("…employee IRD ••• for tax…") without seeing the value.
- **Deleting data**: `deleteTenant` removes every row, including scans, findings, drafts and audit
  events. Removing a file in SharePoint removes its scan on the next sync.

## LLM classification

Disabled unless the operator sets `LLM_PROVIDER` **and** an IT admin enables "LLM second opinion" in
Settings → Content scanning (policy drafting from documents uses the endpoint whenever configured).

| Provider            | Accepted endpoints                                                                                                                                      |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `azure-openai`      | `*.openai.azure.com`, `*.cognitiveservices.azure.com`, `*.services.ai.azure.com` (the client's resource), or hosts listed in `LLM_ALLOWED_HOSTS`.       |
| `openai-compatible` | `localhost`, private IP ranges, single-label hosts (e.g. `ollama`), `*.local` / `*.internal`, or hosts in `LLM_ALLOWED_HOSTS` (e.g. a private gateway). |

- Public AI APIs (`api.openai.com`, `api.anthropic.com`, Google/xAI/Mistral/Cohere/… hosts) are
  **always refused**, even if listed in `LLM_ALLOWED_HOSTS`.
- HTTPS is required except for private hosts; redirects are refused (`redirect: 'error'`).
- The first 12,000 characters of each scanned file's text are sent, with every identifier the
  deterministic detectors found **pre-redacted**, plus an instruction to return a level id, categories
  and a one-sentence reason that must not quote personal information (the reason is redacted again
  before it is stored).
- The model can only **raise** a classification and only with confidence ≥ 0.7. The model name and
  host are recorded on the scan and in the audit log (`scan.llm.use`).
- With Azure OpenAI, use a resource in the client's subscription and region; disable abuse-monitoring
  data retention if eligible.

## Telemetry

Off by default. When the client sets `TELEMETRY_ENABLED=true` and `TELEMETRY_ENDPOINT`, after each
analysis the worker POSTs:

```json
{
  "schema": 1,
  "install": "3f1c0a9e5b7d2e41",
  "appVersion": "0.2.0",
  "connectors": ["microsoft-graph"],
  "llmProvider": "none",
  "buckets": {
    "licensedUsers": "100-999",
    "filesScanned": "10000-99999",
    "classifiedFiles": "100-999"
  },
  "findingsBySeverity": { "critical": 3, "high": 12, "medium": 20 },
  "rulesFired": ["LAB-001", "OVR-001", "POL-001"]
}
```

`install` is a truncated SHA-256 of the tenant id and `TELEMETRY_SALT`. No names, URLs, file or site
details, findings text, policy content, snippets or personal data are included (enforced by a unit
test). Every send is written to the audit log with the full payload (`telemetry.send`).

Third-party telemetry is disabled too: the images and templates set `NEXT_TELEMETRY_DISABLED=1`
(Next.js CLI) and `CHECKPOINT_DISABLE=1` (Prisma update checks).

## Personal data

Usage data is per person (needed for licence reclamation and team coaching). Managers only see their
own department. Content findings show **counts** of personal information per file, not the
information. If the client prefers, keep Microsoft 365 report concealment ON (PILOT_SETUP step 6).
Document the lawful basis (e.g. legitimate interest for information security and records management)
and, for NZ clients, align with the Privacy Act 2020 (IPP 5 storage and security, IPP 11 disclosure)
— content scanning is an internal security control performed by the agency itself on its own systems.

## Hygiene checklist

- Use a certificate or a client secret with ≤ 6-month expiry for the Graph app registration.
- Conditional Access for workload identities: allow the Graph app only from the deployment's egress IP.
- Use Entra SSO for app users; rotate `NEXTAUTH_SECRET`.
- Keep the web app internal (default in the Bicep template) or behind the client's reverse proxy/WAF.
- Review Settings → Audit log monthly; keep vendor access off when not in use.
