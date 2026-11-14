# Vendor access — zero by default

The app is installed and run by the client. The app vendor (Weltrous / the app creator) has **no
access** to the deployment, its database, its findings or the client's Microsoft 365 data:

- no vendor accounts exist in the app,
- no vendor credentials, keys or VPN are part of the deployment,
- no data is sent to the vendor (telemetry is off unless the client opts in — see SECURITY.md),
- content is never stored, so even a database copy contains no file content.

When the client needs help (a sync failing, a bug), the client's IT admin can grant **time-boxed,
scoped, audited** access from inside the app. This page explains how.

## Granting access

1. Sign in as an **IT** user → **Governance → Vendor access**.
2. Click **Allow time-boxed grants** (the master switch; recorded as `vendor.enable`).
3. Fill in:
   - **Vendor engineer email** — becomes a `VENDOR_SUPPORT` user in this deployment only.
   - **Scope**
     - `diagnostics` — the Support diagnostics page only: app/Node version, database type, which
       environment variables are _set_ (never their values), connector status, sync durations,
       warning counts and scan status counts. **No findings, no file/site/person names, no policy.**
     - `read-only` — additionally the ICT dashboard, Content & policy breaches, executive view,
       report and connectors pages. Still no settings, policy editor, audit log, vendor access,
       manager views or CSV exports, and **no write actions** of any kind.
   - **Expires after** — 1 to 168 hours (7 days).
   - **Reason / ticket** — stored with the grant and in the audit log.
4. Click **Grant**. A random **one-time password** is shown once. Pass it to the engineer through a
   channel you trust (password manager share, phone). Alternatively, if you have enabled Entra SSO
   for the app and invited the engineer as a guest, they can use SSO — the grant is still required.

The grant is recorded as `vendor.grant` with scope and expiry.

## What the vendor experiences

- A yellow banner on every page: "Vendor support session (scope) — read-only, time-boxed and audited".
- Navigation limited to the grant's scope; any other URL redirects to the support page.
- Every page view is logged (`page.view` with the path), as is the sign-in (`auth.vendor.login`).
  Failed or out-of-grant attempts are logged too (`auth.vendor.denied`, `auth.login.failed`).

## Ending access

Access ends at the **earliest** of:

- **Expiry** — enforced in middleware from the session and re-checked in the database on every page
  and action.
- **Revoke now** on a grant (`vendor.revoke`) — the next request is rejected; the vendor user's
  password hash is deleted when no other active grant remains.
- **Turn off and revoke all** (the master switch) — every active grant is revoked.
- Emergency, from a shell on the host: `npm run worker -- vendor-revoke-all --tenant <slug>`.

## Reviewing what the vendor did

**Governance → Audit log**, filter by the vendor email, or the "Recent vendor activity" panel on
the Vendor access page. Audit events are append-only from the app's point of view and are deleted
only with the tenant.

## Infrastructure-level access (outside the app)

The in-app grant does not give shell, database or Azure access. If an engineer must look at
containers or logs, use your normal privileged-access process (e.g. Azure PIM with a time-bound
role assignment on the resource group, or a supervised screen share). Logs never contain file
content: the scanner records only file ids, statuses and reasons.
