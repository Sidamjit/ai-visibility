# Classification policy guide

The policy tells the app **what each classification level means for handling** and **which content
belongs at which level**. Content scanning finds what is in each file; the policy turns that into a
level; the analysis then compares the level with how the file is actually shared, labelled, stored
and retained, and reports every breach with evidence and a fix.

- Edit it in the app: **Governance → Classification policy** (YAML/JSON editor with validation).
- Or from the host: `npm run worker -- policy-import --tenant <slug> --file policy.yaml`
  (`policy-export`, `policy-sample` print the current/sample policy).
- Saving re-evaluates every scanned file immediately — files are **not** re-read.
- Until a policy is saved, the **NZ sample** (`packages/policy/samples/nz-psr-sample.yaml`) applies.

> The sample follows the NZ Protective Security Requirements (PSR) classification names
> (Unclassified, In-Confidence, Sensitive, Restricted) and NZ public-records retention practice. It is a
> starting point for a workshop with the client's information-management and privacy owners, not
> legal advice. Any level names work (e.g. Public / Internal / Confidential / Highly Confidential).

## Structure

```yaml
schemaVersion: 1
name: Contoso information classification policy
owner: Information Management
version: '2026.1'
sources: ['Contoso Information Management Policy v4 (2025)'] # titles only, not content
defaultLevel: UNCLASSIFIED # level for scanned files that match no content rule
levels: [...] # what each level allows
contentRules: [...] # what content puts a file at a level
classifiers: # detector configuration
  disabled: ['phone-number'] # switch off built-ins that are noise for you
  custom: [...] # your own keyword/regex detectors
```

### Levels

| Field                                | Meaning                                                                                                                                                               |
| ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`, `name`, `description`, `color` | Identity and display. `id`: letters, digits, `.`, `_`, `-`.                                                                                                           |
| `rank`                               | 0–100, higher = more sensitive. Unique.                                                                                                                               |
| `breachSeverity`                     | `critical` / `high` / `medium` / `low` / `info` — severity of sharing/audience breaches at this level. Label and location breaches are one step lower, retention two. |
| `sharing.anyoneLinks`                | Are "Anyone with the link" links allowed?                                                                                                                             |
| `sharing.organizationLinks`          | Are "People in your organisation" links allowed?                                                                                                                      |
| `sharing.externalGuests`             | May guests reach it (links, direct grants or guest members of the site)?                                                                                              |
| `sharing.publicSites`                | May it sit on a public (org-joinable) Team/site?                                                                                                                      |
| `sharing.maxAudience`                | Max people who can reach it (site members + direct grantees). `null` = no limit.                                                                                      |
| `labels.required`                    | Must the file carry a sensitivity label?                                                                                                                              |
| `labels.acceptedLabels`              | Accepted label names (case-insensitive). Empty = any label that meets `minimumPriority` / is sensitive.                                                               |
| `labels.minimumPriority`             | Minimum Purview label priority (higher = more sensitive).                                                                                                             |
| `retention.maxAgeDays`               | Untouched longer than this = breach (`action`: `review` / `archive` / `dispose`; `reference` e.g. a GDA class).                                                       |
| `locations.allowedSitePatterns`      | Only these sites (glob on site name **or** URL, `*` = anything). Empty = anywhere.                                                                                    |
| `locations.blockedSitePatterns`      | Never these sites (e.g. `*intranet*`, `*all staff*`).                                                                                                                 |
| `locations.allowOneDrive`            | May it live in personal OneDrive?                                                                                                                                     |
| `locations.allowedDepartments`       | Owning department of the site must be one of these. Empty = any.                                                                                                      |

### Content rules

Each rule maps detector results to a level. A file gets the **highest** level of any rule it meets
(and of the LLM opinion, if enabled — which can only raise it).

```yaml
contentRules:
  - id: bulk-tax-or-bank
    description: Lists of IRD, TFN or bank account numbers (5+ distinct values).
    level: SENSITIVE
    classifiers: [nz-ird-number, nz-bank-account, au-tfn] # ANY of these…
    minCount: 1 # …with at least this many matches in the file
    minDistinct: 5 # …and this many DIFFERENT values (a list of people, not one form)
    minConfidence: medium
```

`minDistinct` is what separates "a payroll export" (Sensitive) from "my own IRD number on a form"
(In-Confidence). Distinct values are counted with a keyed hash in memory; values are never stored.

### Built-in detectors

| Id                     | Detects                           | Validation                                                                                            |
| ---------------------- | --------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `nz-ird-number`        | NZ IRD numbers                    | IRD mod-11 check digit with secondary weights; range 10,000,000–150,000,000                           |
| `nz-bank-account`      | NZ bank account numbers           | Inland Revenue bank-account modulus algorithms (A, B, D, E, F, G, X) and bank id list                 |
| `nz-driver-licence`    | NZ driver licence numbers         | Format plus required licence context (there is no public check digit)                                 |
| `nz-passport`          | NZ passport numbers               | Format plus required "passport" context (there is no public check digit)                              |
| `nz-nhi`               | National Health Index numbers     | HISO 10046 check character (mod 11 legacy, mod 23 expanded format)                                    |
| `credit-card`          | Payment card numbers              | Issuer prefix (IIN) and Luhn check digit                                                              |
| `au-tfn`               | Australian Tax File Numbers       | ATO weighted mod-11 check; high confidence only with "TFN"/"tax file" context                         |
| `email-address`        | Email addresses                   | RFC-style pattern with a dotted domain                                                                |
| `phone-number`         | NZ/AU phone numbers               | Numbering-plan prefixes and lengths                                                                   |
| `secret-credential`    | Passwords, API keys, private keys | Vendor-specific token formats (high) or `password=`-style assignments, placeholders filtered (medium) |
| `health-information`   | Health terms                      | Whole-word keyword list; distinct = distinct terms                                                    |
| `personal-information` | Personal-information terms, DOBs  | Keyword list (medium) and labelled dates of birth (high)                                              |

Exact ids and descriptions are listed in-app (Classification policy → Built-in detectors).

### Custom detectors

```yaml
classifiers:
  custom:
    - id: legal-privilege
      name: Legal privilege marking
      category: custom
      keywords: ['legally privileged', 'privileged and confidential', 'solicitor-client']
      confidence: high
    - id: contoso-staff-id
      name: Contoso staff number
      pattern: 'CTS-\d{6}' # JavaScript regex source, matched globally
      confidence: medium
      # validator: luhn | nz-ird | nz-bank | nz-nhi | au-tfn   (optional)
```

Reference a custom detector by id in `contentRules`. The editor warns about rules that reference
unknown or disabled detectors.

## Drafting a policy from your documents

**Classification policy → Draft from your policy documents**: upload your information-management /
classification policy (docx, pdf, txt, md…). The document is read in memory and **not stored** (only
its name and SHA-256 are kept with the draft).

- Without an LLM: patterns find classification markings (UNCLASSIFIED / IN-CONFIDENCE / SENSITIVE /
  RESTRICTED / CONFIDENTIAL / INTERNAL…), retention periods ("retain for 7 years"), and handling
  phrases ("must not be shared externally", "must be labelled …"). Everything else comes from the NZ
  sample. Notes explain what was detected and what was assumed.
- With the client's LLM endpoint configured (`LLM_PROVIDER`): the model drafts levels and rules as
  JSON, which is validated against the schema; invalid output is rejected and the heuristic draft is
  shown instead.

Drafts are **never applied automatically**. Review the YAML and notes, then **Accept & apply** or
**Reject** (both audit-logged). CLI: `npm run worker -- policy-draft --tenant <slug> --file policy.docx`.

## How breaches are reported

| Rule    | Breach                                                                    | Default severity                    |
| ------- | ------------------------------------------------------------------------- | ----------------------------------- |
| POL-001 | Anyone / org-wide links or guest access the level does not allow          | level's `breachSeverity`            |
| POL-002 | Public site, or more people can reach it than `maxAudience`               | level's `breachSeverity`            |
| POL-003 | Missing or too-low sensitivity label                                      | one step lower                      |
| POL-004 | Stored on a blocked / non-approved site, in OneDrive, or wrong department | one step lower                      |
| POL-005 | Not modified for longer than the retention period                         | two steps lower                     |
| SEC-001 | Credentials (passwords, keys, tokens) in documents                        | critical if exposed, otherwise high |

Each finding lists, per file: location and link, classification and why (detectors × counts), the
applied label, **who has access** (anyone links, org links, guests, approximate audience), the
specific breaches, redacted snippets (if enabled), and ordered fix steps.
