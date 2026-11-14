# Adding an analysis rule

Rules turn normalized data into **findings** with evidence and a recommended fix.

## 1. Pick an ID and file name

`packages/analysis/src/rules/<area>-<nnn>-<slug>.ts`, e.g. `ovr-007-anyone-links-without-expiry.ts`.

| Prefix | Area                        |
| ------ | --------------------------- |
| OVR    | Oversharing / exposure      |
| LAB    | Labelling                   |
| IDN    | Identity & access hygiene   |
| RDY    | Copilot / AI readiness      |
| LIC    | Licensing                   |
| ADO    | Adoption                    |
| CAP    | Capability                  |
| SPD    | Spend                       |
| VAL    | Value                       |
| POL    | Content vs policy           |
| SEC    | Security hygiene in content |

Never reuse or renumber an ID — `findingKey = ruleId:key` links findings across runs and keeps
remediation ticks.

## 2. Write the rule

```ts
/**
 * OVR-007 — Anyone links without expiry.
 * (Explain WHAT it detects and WHY it matters in plain English.)
 */
import type { RuleDefinition } from '../types';
import { eachSite } from './helpers';

export const anyoneNoExpiryRule: RuleDefinition = {
  id: 'OVR-007',
  name: 'Anyone links without expiry',
  category: 'oversharing',
  kind: 'risk',
  description: 'Anyone links that never expire.',
  rationale: 'Permanent anonymous links accumulate and outlive their purpose…',
  evaluate(ctx) {
    return eachSite(ctx).flatMap(({ site, grants }) => {
      const hits = grants.filter((g) => g.scope === 'anyone' && !g.expiresAt);
      if (!hits.length) return [];
      return [
        {
          ruleId: 'OVR-007',
          key: site.externalId,
          kind: 'risk',
          category: 'oversharing',
          severity: 'medium',
          title: `…`,
          summary: `…`,
          evidence: { items: hits.map(/* metadata only */) },
          siteExternalId: site.externalId,
          departmentName: site.ownerDepartment,
          affectedCount: hits.length,
          monthlyImpact: null,
          recommendation: {
            title: '…',
            steps: ['…'],
            audience: ['IT'],
            effort: 'low',
            impact: 'medium',
          },
        },
      ];
    });
  },
};
```

Guidelines:

- **Pure**: no I/O, no `Date.now()` — use `ctx.asOf`.
- **Use shared definitions** from `ctx.index` (`isSensitive`, `isStale`, `isBroadSite`,
  `isActiveSeat`, `intensity`, …) instead of re-deriving them.
- **No magic numbers**: thresholds and money go in `Assumptions` (`@aiv/core/assumptions.ts`) with a
  label and help text — they then appear in Settings and in the report automatically.
- **Evidence never contains content**: names, counts, dates, scopes, and at most the already
  redacted snippets from `ContentScan`. Arrays of objects render as tables.
- **Content/policy rules**: use `ctx.index.content` (classified files with level, exposure facts and
  breaches from `@aiv/policy`) and the `policyRule` helper in `rules/pol-helpers.ts`; return `[]` when
  `ctx.policy` is null. Handling thresholds belong in the tenant policy, not in the rule.
- **Steps are actionable**: name the admin centre/screen and the setting.
- **Audience** decides which dashboards show it: `IT`, `EXECUTIVE`, `MANAGER`.
- **Granularity**: one finding per site (oversharing), per department (adoption), or per org.

## 3. Register and test

1. Add to `RULES` in `packages/analysis/src/rules/index.ts`.
2. Add a `describe` block to `rules.test.ts` (or `policy-rules.test.ts` for content rules, with the
   `scan()` builder) using the builders in `src/test-builders.ts` (positive case, negative case,
   severity boundaries).
3. `engine.test.ts` asserts every registered rule fires on the demo org — if yours doesn't, extend
   the demo generator (`packages/connectors/src/demo`) so the demo shows it.
4. `npm test`.
