/**
 * SEC-001 — Credentials (passwords, keys, tokens, connection strings) found
 * inside documents. Reported regardless of the classification policy.
 */
import type { RuleDefinition } from '../types';
import { fileEvidence, listFiles } from './pol-helpers';

export const secretsInContentRule: RuleDefinition = {
  id: 'SEC-001',
  name: 'Credentials stored in documents',
  category: 'policy',
  kind: 'risk',
  description:
    'Content scanning found passwords, API keys, private keys or connection strings inside files.',
  rationale:
    'Credentials in documents are routinely harvested in breaches and are surfaced by search and Copilot to anyone with access. They must be rotated, not just moved.',
  evaluate(ctx) {
    const content = ctx.index.content;
    if (!content) return [];
    const bySite = new Map<string, typeof content.files>();
    for (const f of content.files) {
      const hit = f.scan.hits.find(
        (h) => h.classifierId === 'secret-credential' && h.confidence !== 'low',
      );
      if (!hit) continue;
      const key = f.site?.externalId ?? 'unknown';
      bySite.set(key, [...(bySite.get(key) ?? []), f]);
    }
    return [...bySite.entries()].map(([siteId, files]) => {
      const site = files[0]!.site;
      const exposed = files.filter(
        (f) =>
          f.facts.anyoneLinks + f.facts.organizationLinks + f.facts.externalPrincipals > 0 ||
          f.facts.publicSite,
      );
      const secrets = files.reduce(
        (s, f) => s + (f.scan.hits.find((h) => h.classifierId === 'secret-credential')?.count ?? 0),
        0,
      );
      return {
        ruleId: 'SEC-001',
        key: siteId,
        kind: 'risk' as const,
        category: 'policy' as const,
        severity: exposed.length ? ('critical' as const) : ('high' as const),
        title: `${secrets} credential(s) in ${files.length} file(s) in "${site?.name ?? siteId}"`,
        summary: `${exposed.length} of the files are shared broadly, publicly or externally.`,
        evidence: {
          files: files.map((f) => fileEvidence(f, f.breaches)),
          detection: 'content scan; credential values are never stored or displayed',
        },
        siteExternalId: site?.externalId ?? null,
        departmentName: site?.ownerDepartment ?? null,
        affectedCount: files.length,
        monthlyImpact: null,
        recommendation: {
          title: 'Rotate the exposed credentials and remove them from documents',
          steps: [
            `Treat every credential in ${listFiles(files)} as compromised: rotate/reset it now.`,
            'Review sign-in and audit logs for the affected accounts/keys since the file was created.',
            'Move secrets to a vault (Azure Key Vault, a password manager) and delete them from the documents and their version history.',
            'Add a Purview DLP rule for credentials to block sharing and alert on new occurrences.',
          ],
          audience: ['IT'],
          effort: 'low',
          impact: 'high',
        },
      };
    });
  },
};
