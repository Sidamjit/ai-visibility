/** Small helpers shared by rule files. Keep rule files focused on the rule's logic. */
import type { ContentLocation, SharingGrant } from '@aiv/core';
import type { RuleContext, Severity } from '../types';

/** Every (site, locations-in-site, non-inherited grants-in-site) triple. */
export function eachSite(
  ctx: RuleContext,
): Array<{ site: ContentLocation; locations: ContentLocation[]; grants: SharingGrant[] }> {
  return ctx.index.sites.map((site) => {
    const locations = ctx.index.locationsBySite.get(site.externalId) ?? [site];
    const grants = locations.flatMap((l) => ctx.index.grantsByLocation.get(l.externalId) ?? []);
    return { site, locations, grants };
  });
}

/** Compact, metadata-only description of a location for evidence tables. */
export function describe(ctx: RuleContext, loc: ContentLocation) {
  return {
    id: loc.externalId,
    name: loc.name,
    kind: loc.kind,
    sensitive: ctx.index.isSensitive(loc),
    labelled: ctx.index.hasSensitiveLabel(loc),
    reasons: loc.sensitivityReasons,
  };
}

export function money(amount: number, currency: string): string {
  return new Intl.NumberFormat('en', {
    style: 'currency',
    currency,
    maximumFractionDigits: 0,
  }).format(amount);
}

export const pctText = (x: number) => `${Math.round(x * 100)}%`;

/** Pick the highest severity whose condition is true, else the fallback. */
export function severityOf(conditions: Array<[boolean, Severity]>, fallback: Severity): Severity {
  return conditions.find(([c]) => c)?.[1] ?? fallback;
}
