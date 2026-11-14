/**
 * Handling evaluation: given a file's classification level and the facts about
 * where it lives and who can reach it, list every way it breaches the policy.
 *
 * Pure function of (level, facts) so it is trivial to unit-test and reuse
 * (analysis rules, UI "what-if", report).
 */
import { matchesAny } from './glob';
import type { PolicyLevel } from './schema';

const DAY = 86_400_000;

/** Facts about one file's exposure, built by the analysis engine from normalized data. */
export interface ExposureFacts {
  anyoneLinks: number;
  organizationLinks: number;
  /** External principals: guest grants, guest members of the site, external link recipients. */
  externalPrincipals: number;
  publicSite: boolean;
  /** People who can reach the content (site members + specific grants), when known. */
  audienceSize: number | null;
  /** Applied sensitivity label (file, else library/site), if any. */
  label: { name: string; priority: number } | null;
  siteName: string | null;
  siteUrl: string | null;
  department: string | null;
  isOneDrive: boolean;
  lastModifiedAt: string | null;
  asOf: Date;
}

export const BREACH_TYPES = [
  'anyone-link',
  'organization-link',
  'external-guest',
  'public-site',
  'audience-exceeded',
  'label-missing',
  'label-insufficient',
  'location-blocked',
  'location-not-allowed',
  'onedrive-not-allowed',
  'department-not-allowed',
  'retention-exceeded',
] as const;
export type BreachType = (typeof BREACH_TYPES)[number];

export type BreachGroup = 'sharing' | 'audience' | 'label' | 'location' | 'retention';

export const BREACH_GROUP: Record<BreachType, BreachGroup> = {
  'anyone-link': 'sharing',
  'organization-link': 'sharing',
  'external-guest': 'sharing',
  'public-site': 'audience',
  'audience-exceeded': 'audience',
  'label-missing': 'label',
  'label-insufficient': 'label',
  'location-blocked': 'location',
  'location-not-allowed': 'location',
  'onedrive-not-allowed': 'location',
  'department-not-allowed': 'location',
  'retention-exceeded': 'retention',
};

export interface PolicyBreach {
  type: BreachType;
  group: BreachGroup;
  /** Plain-English explanation naming the policy requirement. */
  message: string;
}

/** Every policy breach for content at `level` with the given exposure. Empty = compliant. */
export function evaluateHandling(level: PolicyLevel, facts: ExposureFacts): PolicyBreach[] {
  const out: PolicyBreach[] = [];
  const add = (type: BreachType, message: string) =>
    out.push({ type, group: BREACH_GROUP[type], message });
  const { sharing, labels, retention, locations } = level;

  // Sharing
  if (!sharing.anyoneLinks && facts.anyoneLinks > 0)
    add(
      'anyone-link',
      `${facts.anyoneLinks} "anyone" link(s); ${level.name} forbids anonymous links.`,
    );
  if (!sharing.organizationLinks && facts.organizationLinks > 0)
    add(
      'organization-link',
      `${facts.organizationLinks} organisation-wide link(s); ${level.name} must be shared with named people only.`,
    );
  if (!sharing.externalGuests && facts.externalPrincipals > 0)
    add(
      'external-guest',
      `${facts.externalPrincipals} external/guest principal(s) can access it; ${level.name} is internal only.`,
    );

  // Audience
  if (!sharing.publicSites && facts.publicSite)
    add(
      'public-site',
      `Stored in a public (org-wide joinable) site; not allowed for ${level.name}.`,
    );
  if (
    sharing.maxAudience !== null &&
    facts.audienceSize !== null &&
    facts.audienceSize > sharing.maxAudience
  )
    add(
      'audience-exceeded',
      `About ${facts.audienceSize} people can reach it; ${level.name} allows at most ${sharing.maxAudience}.`,
    );

  // Labels
  if (labels.required) {
    if (!facts.label) add('label-missing', `${level.name} content must carry a sensitivity label.`);
    else {
      const accepted =
        labels.acceptedLabels.length === 0 ||
        labels.acceptedLabels.some((n) => n.toLowerCase() === facts.label!.name.toLowerCase());
      const highEnough =
        labels.minimumPriority === null || facts.label.priority >= labels.minimumPriority;
      if (!accepted || !highEnough)
        add(
          'label-insufficient',
          `Label "${facts.label.name}" is below what ${level.name} requires${
            labels.acceptedLabels.length ? ` (${labels.acceptedLabels.join(' / ')})` : ''
          }.`,
        );
    }
  }

  // Locations
  const where = [facts.siteName, facts.siteUrl];
  if (facts.isOneDrive && !locations.allowOneDrive)
    add('onedrive-not-allowed', `${level.name} content must not be kept in personal OneDrive.`);
  if (locations.blockedSitePatterns.length && matchesAny(locations.blockedSitePatterns, where))
    add(
      'location-blocked',
      `"${facts.siteName ?? 'This site'}" is a blocked location for ${level.name}.`,
    );
  else if (
    !facts.isOneDrive &&
    locations.allowedSitePatterns.length &&
    !matchesAny(locations.allowedSitePatterns, where)
  )
    add(
      'location-not-allowed',
      `"${facts.siteName ?? 'This site'}" is not an approved location for ${level.name} (allowed: ${locations.allowedSitePatterns.join(', ')}).`,
    );
  if (
    locations.allowedDepartments.length &&
    facts.department &&
    !locations.allowedDepartments.some((d) => d.toLowerCase() === facts.department!.toLowerCase())
  )
    add(
      'department-not-allowed',
      `Owned by ${facts.department}, which may not hold ${level.name} content.`,
    );

  // Retention
  if (retention.maxAgeDays !== null && facts.lastModifiedAt) {
    const age = Math.floor((facts.asOf.getTime() - new Date(facts.lastModifiedAt).getTime()) / DAY);
    if (age > retention.maxAgeDays)
      add(
        'retention-exceeded',
        `Unchanged for ${age} days; ${level.name} retention is ${retention.maxAgeDays} days (${retention.action}${
          retention.reference ? `, ${retention.reference}` : ''
        }).`,
      );
  }
  return out;
}
