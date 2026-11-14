# Pilot setup — Microsoft 365 (SharePoint, OneDrive & Copilot)

This guide is for the **client's Microsoft 365 / Entra ID administrator**. It takes about
20 minutes. You will create an app registration that gives the platform **read-only** access to your
tenant. You can revoke it at any time by deleting the app registration.

The platform runs **inside your environment** (your server or your Azure subscription — see
[DEPLOYMENT.md](DEPLOYMENT.md)). When content scanning is on, it reads file content **in memory** to
compare what files contain with your classification policy, then discards it. File content is never
stored and never sent to the vendor; the vendor cannot sign in unless you grant time-boxed access
([VENDOR_ACCESS.md](VENDOR_ACCESS.md)).

## What the app can and cannot see

| It reads                                                                                                                                       | It never reads                       |
| ---------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------ |
| SharePoint/Teams site and library names, URLs, modified dates                                                                                  | Mailboxes, Teams chats or meetings   |
| File/folder **names** and sharing settings for items that are shared, sensitive-named or classified                                            | Copilot prompts or responses         |
| **File content** (allow-listed types, size-capped) — in memory only, when content scanning is on; it stores detector counts, never the content | Passwords or credentials of any kind |
| Microsoft 365 group visibility (public/private), member and guest counts, sensitivity labels                                                   |                                      |
| Users' name, UPN, department, job title, guest status, licences, last sign-in date                                                             |                                      |
| Microsoft 365 Copilot usage report (last activity date per Copilot app, active days)                                                           |                                      |

No permission allows writing, deleting or changing anything.

## Prerequisites

- **Global Administrator** or **Privileged Role Administrator** (needed to grant admin consent to
  Microsoft Graph _application_ permissions).
- For last sign-in dates: Microsoft Entra ID P1 or P2 (optional).

## Step 1 — Register the app

1. Go to **https://entra.microsoft.com** → **Identity → Applications → App registrations → New registration**.
2. **Name**: `Lumen AI Insight (read-only)` (or the name your consultant gives you).
3. **Supported account types**: _Accounts in this organizational directory only (Single tenant)_.
4. **Redirect URI**: leave empty.
5. Click **Register**.
6. On the **Overview** page copy:
   - **Application (client) ID** → `GRAPH_CLIENT_ID`
   - **Directory (tenant) ID** → `GRAPH_TENANT_ID`

## Step 2 — Add API permissions (application, read-only)

1. In the app: **API permissions → Add a permission → Microsoft Graph → Application permissions**.
2. Add exactly these permissions:

| Permission                             | Required | Why                                                                                                                                                                                                                                                                                                                                          |
| -------------------------------------- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Sites.Read.All`                       | Yes      | List SharePoint sites and document libraries.                                                                                                                                                                                                                                                                                                |
| `Files.Read.All`                       | Yes      | Read file/folder metadata and sharing permissions (anyone links, organisation-wide links, guest access, unique permissions); **download file content into memory** for classification (when content scanning is on); read the sensitivity label applied to classified files (`extractSensitivityLabels`, a read action). Nothing is written. |
| `User.Read.All`                        | Yes      | Map people to departments, detect guests, read licence assignments.                                                                                                                                                                                                                                                                          |
| `Group.Read.All`                       | Yes      | Microsoft 365 group/Team visibility, member & guest counts, group sensitivity labels.                                                                                                                                                                                                                                                        |
| `Reports.Read.All`                     | Yes      | Microsoft 365 Copilot usage reports (adoption, inactive seats, feature breadth).                                                                                                                                                                                                                                                             |
| `AuditLog.Read.All`                    | Optional | Last sign-in date (dormant accounts). Needs Entra ID P1/P2.                                                                                                                                                                                                                                                                                  |
| `InformationProtectionPolicy.Read.All` | Optional | Names and ranking of your Purview sensitivity labels.                                                                                                                                                                                                                                                                                        |

3. Remove the default delegated `User.Read` permission (not needed).
4. Click **Grant admin consent for <your organisation>** and confirm. All rows should show a green
   "Granted" status.

### Sensitivity labels and Purview — what the app can and cannot see

- **Label catalogue** (names, priority): `InformationProtectionPolicy.Read.All` (optional).
- **Container labels** on Teams/M365 groups/sites: `Group.Read.All`.
- **File labels**: `POST /drives/{d}/items/{i}/extractSensitivityLabels` with `Files.Read.All`,
  called only for files the scan classified. Supported for Office files and PDFs; other types report
  no label. A default library label applies only to new/edited files, so older files may show "no label".
- **Encrypted files** (labels with encryption, IRM libraries, Double Key Encryption) are downloaded
  encrypted and **cannot be read** by the app (no Microsoft Purview/RMS super-user rights are
  requested). They are listed as "unreadable" with their label and sharing still analysed.
- **Purview DLP / auto-labelling / Content Explorer results** are not available to app-only Graph
  permissions, so the app uses its own validated detectors. It never applies or changes labels.
- **"Everyone except external users"** granted at site level is a SharePoint permission not exposed by
  Graph; such exposure is not counted (planned via SharePoint REST, read-only).

## Step 3 — Create a client secret

1. **Certificates & secrets → Client secrets → New client secret**.
2. Description `pilot`, expiry **6 months** (or the pilot length).
3. Copy the **Value** immediately (shown once) → `GRAPH_CLIENT_SECRET`.

> Send the three values to your consultant through a secure channel (e.g. a password manager share
> or encrypted message) — **never by plain email or chat**.

## Step 4 (recommended) — Restrict where the app can be used

If you have Workload Identities Premium, create a **Conditional Access policy for workload
identities** that only allows this app from your deployment's egress IP address(es).

## Step 5 — Confirm Copilot usage reports are populated

Microsoft 365 admin center → **Reports → Usage → Microsoft 365 Copilot**. Data appears 24–72 hours
after licences are assigned. The Graph API returns data for **licensed Copilot users only**.

## Step 6 — Decide on report concealment (privacy choice)

By default Microsoft 365 conceals user names in usage reports (you'll see hashed IDs). To get
per-person Copilot adoption (needed for licence reclamation and team coaching):

**Microsoft 365 admin center → Settings → Org settings → Services → Reports →** untick
**"Display concealed user, group, and site names in all reports"**.

If you keep concealment on, the platform still shows SharePoint exposure and licence counts, but
per-user Copilot usage cannot be matched (the Connectors page will show a warning).

## Step 7 — Your consultant connects the tenant

Whoever operates the deployment (your IT team, or the consultant on your server while you watch)
runs:

```bash
# 1. Secrets go in the environment (.env or the host's secret store) — never in the database
GRAPH_TENANT_ID=<directory id>
GRAPH_CLIENT_ID=<application id>
GRAPH_CLIENT_SECRET=<secret value>

# 2. Create the tenant, its first IT user, and attach the Microsoft Graph connector
npm run worker -- create-tenant --name "Client Ltd" --slug client \
  --admin-email it.lead@client.com --admin-name "IT Lead" --admin-password '<12+ char password>'

# 3. Verify credentials and permissions (no data is pulled)
npm run worker -- check --tenant client
#   microsoft-graph: OK — Connected to Microsoft Graph with the required read-only permissions.

# 4. First sync + analysis (large tenants: allow 30–120 min; later runs are incremental)
npm run worker -- sync --tenant client

# 5. Add executive and manager users
npm run worker -- add-user --tenant client --email ceo@client.com --name "CEO" --role EXECUTIVE --password '<…>'
npm run worker -- add-user --tenant client --email fin.mgr@client.com --name "Finance Manager" --role MANAGER --department Finance --password '<…>'
```

> **Multiple client tenants on one deployment:** the v0.1 Graph connector reads its credentials from
> the `GRAPH_*` environment variables, so one deployment serves one Microsoft 365 tenant. For more,
> run one worker per client (separate env) or extend `secretsFor()` in `packages/pipeline/src/sync.ts`
> to read per-tenant secrets from a vault.

The worker then re-syncs every `SYNC_INTERVAL_MINUTES` (default 6 hours).

## Step 7b — Set your classification policy and content scanning

1. Sign in as the IT user → **Governance → Classification policy**. Start from the NZ sample or
   upload your information-management policy to get a draft ([POLICY_GUIDE.md](POLICY_GUIDE.md)).
   Review and save.
2. **Governance → Content scanning**: confirm file types, size limit (default 25 MB) and snippet mode
   (default **off** = counts only). Turn scanning off if you only want metadata analysis.
3. Run a sync (Connectors → Sync now, or `npm run worker -- sync --tenant client`). Results appear in
   **Content & policy breaches**, the executive overview, the report and the CSV exports.
4. Leave **Governance → Vendor access** off unless you need support.

## Step 8 — End of pilot

Delete the app registration (Entra admin center → App registrations → the app → **Delete**). Access
stops immediately. Delete the deployment (or run `deleteTenant`, which removes every row including
scans, findings, drafts and the audit log).

## Troubleshooting

| Symptom                                             | Fix                                                                                                                                    |
| --------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `check` reports missing permissions                 | Admin consent not granted, or a permission was added as _Delegated_ instead of _Application_.                                          |
| Warning "usage rows could not be matched"           | Report concealment is on (Step 6).                                                                                                     |
| Warning "Sign-in activity skipped"                  | `AuditLog.Read.All` not granted or no Entra ID P1 — optional.                                                                          |
| Warning "Sensitivity labels skipped"                | `InformationProtectionPolicy.Read.All` not granted — optional.                                                                         |
| Slow first sync / throttling                        | Normal for large tenants; the connector honours Graph `Retry-After`. Lower `concurrency` in the connector config if needed.            |
| Warning "Content scan reached the per-run cap"      | More changed files than `maxFilesPerRun`; the rest are scanned on the next sync (nothing is skipped).                                  |
| Many files "failed: encrypted"                      | Expected for label-encrypted files; their label and sharing are still analysed.                                                        |
| Warning "File sensitivity labels could not be read" | `extractSensitivityLabels` failed for some files (unsupported type or transient error); label checks fall back to library/site labels. |
