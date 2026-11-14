/**
 * Scoring: per-site Copilot readiness and the org-level Risk & Value scores.
 *
 * Every deduction/weight is documented inline. Scores are meant to be
 * EXPLAINABLE to an executive ("why is our risk 72?"), so each score returns
 * its components and the UI shows them.
 */
import type { RuleContext, ScoreBreakdown, SiteScore, OrgMetrics, Finding } from './types';

/**
 * Copilot readiness for one site, 0-100 (100 = safe for Copilot to reason over).
 *
 * Copilot answers using everything a user can access. A site is "ready" when
 * access matches need and sensitive content is labelled. Deductions:
 */
export function siteReadiness(
  site: RuleContext['index']['sites'][number],
  ctx: RuleContext,
): SiteScore {
  const { index, assumptions } = ctx;
  const locations = index.locationsBySite.get(site.externalId) ?? [site];
  const grants = locations.flatMap((l) => index.grantsByLocation.get(l.externalId) ?? []);
  const sensitive = locations.filter((l) => index.isSensitive(l));
  const sensitiveIds = new Set(sensitive.map((l) => l.externalId));
  const unlabeledSensitive = sensitive.filter((l) => !index.hasSensitiveLabel(l)).length;
  const anyone = grants.filter((g) => g.scope === 'anyone');
  const org = grants.filter((g) => g.scope === 'organization');
  const external = grants.filter((g) => g.scope === 'external-guest');
  const unique = locations.filter((l) => l.hasUniquePermissions).length;
  const stale = index.isStale(site);
  const broad = index.isBroadSite(site);

  let score = 100;
  const deductions: string[] = [];
  const deduct = (points: number, reason: string) => {
    score -= points;
    deductions.push(`-${points}: ${reason}`);
  };

  if (anyone.some((g) => sensitiveIds.has(g.locationExternalId)))
    deduct(30, 'Anyone links on sensitive content');
  else if (anyone.length)
    deduct(Math.min(20, anyone.length * 5), `${anyone.length} anyone link(s)`);
  if (broad && sensitive.length) deduct(20, 'Sensitive content on an org-wide / very large site');
  if (org.some((g) => sensitiveIds.has(g.locationExternalId)))
    deduct(15, 'Organisation-wide links on sensitive content');
  if (external.length)
    deduct(
      10,
      `${external.reduce((s, g) => s + Math.max(1, g.externalPrincipalCount), 0)} external guest grant(s)`,
    );
  if (unlabeledSensitive)
    deduct(
      Math.min(15, unlabeledSensitive * 5),
      `${unlabeledSensitive} sensitive item(s) without a label`,
    );
  if (stale)
    deduct(
      10,
      `No changes in ${assumptions.staleContentDays}+ days (stale but still discoverable)`,
    );
  if ((site.memberCount ?? 0) > assumptions.excessiveMembershipThreshold)
    deduct(10, `${site.memberCount} members`);
  if (unique >= 3) deduct(5, `${unique} items with broken permission inheritance`);

  return {
    siteExternalId: site.externalId,
    name: site.name,
    department: site.ownerDepartment,
    webUrl: site.webUrl,
    readiness: Math.max(0, score),
    deductions,
    sensitiveItems: sensitive.length,
    anyoneLinks: anyone.length,
    orgLinks: org.length,
    externalGrants: external.length,
    uniquePermissionItems: unique,
    memberCount: site.memberCount,
    visibility: site.visibility,
    stale,
  };
}

const pct = (x: number) => Math.round(Math.max(0, Math.min(1, x)) * 100);

/**
 * Org-level scores.
 *
 * RISK (0-100, higher = worse) = weighted average of:
 *   exposure   40%  share of sensitive locations exposed via anyone/org/guest links or broad sites
 *   labelling  20%  share of sensitive locations without a sensitivity label
 *   readiness  20%  100 - average site readiness
 *   severity   10%  critical/high findings density (critical=2, high=1 points; saturates at 4 points per site)
 *   waste      10%  share of paid seats that are inactive
 *
 * When content scanning + a policy are in place, a POLICY component is added
 * and the weights become: exposure 30, labelling 15, readiness 15, severity 10,
 * waste 10, policy 20 — where policy = share of classified files (above the
 * default level) that breach their level's handling rules.
 *
 * VALUE (0-100, higher = better) = weighted average of:
 *   adoption   40%  active seats / licensed seats
 *   breadth    20%  average apps used per active user / 6
 *   roi        40%  estimated value / spend, saturating at 3x
 */
export function computeScores(
  ctx: RuleContext,
  metrics: OrgMetrics,
  siteScores: SiteScore[],
  findings: Finding[],
): ScoreBreakdown {
  const { index, data } = ctx;
  const sensitive = data.locations.filter((l) => index.isSensitive(l));
  const exposed = sensitive.filter((l) => {
    const grants = index.grantsByLocation.get(l.externalId) ?? [];
    const site = index.siteOf(l);
    return (
      grants.some(
        (g) => g.scope === 'anyone' || g.scope === 'organization' || g.scope === 'external-guest',
      ) || (site ? index.isBroadSite(site) : false)
    );
  });
  const avgReadiness = siteScores.length
    ? siteScores.reduce((s, x) => s + x.readiness, 0) / siteScores.length
    : 100;
  const severityPoints = findings
    .filter((f) => f.kind === 'risk')
    .reduce((s, f) => s + (f.severity === 'critical' ? 2 : f.severity === 'high' ? 1 : 0), 0);
  const severityDensity = severityPoints / Math.max(1, index.sites.length * 4);

  const riskComponents = {
    exposure: pct(sensitive.length ? exposed.length / sensitive.length : 0),
    labelling: pct(sensitive.length ? metrics.unlabeledSensitive / sensitive.length : 0),
    readiness: pct(1 - avgReadiness / 100),
    severity: pct(severityDensity),
    waste: pct(metrics.licensedSeats ? metrics.inactiveSeats / metrics.licensedSeats : 0),
  };
  const content = index.content?.metrics;
  let riskScore: number;
  let allRiskComponents: Record<string, number> = riskComponents;
  if (content && content.classifiedFiles > 0) {
    const policyComponent = pct(content.breachingFiles / content.classifiedFiles);
    allRiskComponents = { ...riskComponents, policy: policyComponent };
    riskScore = Math.round(
      riskComponents.exposure * 0.3 +
        riskComponents.labelling * 0.15 +
        riskComponents.readiness * 0.15 +
        riskComponents.severity * 0.1 +
        riskComponents.waste * 0.1 +
        policyComponent * 0.2,
    );
  } else {
    riskScore = Math.round(
      riskComponents.exposure * 0.4 +
        riskComponents.labelling * 0.2 +
        riskComponents.readiness * 0.2 +
        riskComponents.severity * 0.1 +
        riskComponents.waste * 0.1,
    );
  }

  const valueComponents = {
    adoption: pct(metrics.adoptionRate),
    breadth: pct(metrics.avgFeatureBreadth / 6),
    roi: pct((metrics.roi ?? 0) / 3),
  };
  const valueScore = Math.round(
    valueComponents.adoption * 0.4 + valueComponents.breadth * 0.2 + valueComponents.roi * 0.4,
  );

  return { riskScore, valueScore, riskComponents: allRiskComponents, valueComponents };
}
