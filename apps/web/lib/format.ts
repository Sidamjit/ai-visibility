/** Display formatting helpers (one place so locale/currency rules stay consistent). */
const LOCALE = 'en-NZ';

export function money(value: number, currency = 'USD', compact = false): string {
  return new Intl.NumberFormat(LOCALE, {
    style: 'currency',
    currency,
    maximumFractionDigits: 0,
    notation: compact && Math.abs(value) >= 10_000 ? 'compact' : 'standard',
  }).format(value);
}

export const num = (v: number) =>
  new Intl.NumberFormat(LOCALE, { maximumFractionDigits: 1 }).format(v);
export const pct = (v: number) => `${Math.round(v * 100)}%`;
export const date = (v: Date | string | null | undefined) =>
  v
    ? new Intl.DateTimeFormat(LOCALE, { day: 'numeric', month: 'short', year: 'numeric' }).format(
        new Date(v),
      )
    : '—';
export const dateTime = (v: Date | string | null | undefined) =>
  v
    ? new Intl.DateTimeFormat(LOCALE, {
        day: 'numeric',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit',
      }).format(new Date(v))
    : '—';

export const SEVERITY_STYLE: Record<string, string> = {
  critical: 'bg-red-600 text-white',
  high: 'bg-orange-500 text-white',
  medium: 'bg-amber-300 text-amber-950',
  low: 'bg-sky-200 text-sky-900',
  info: 'bg-slate-200 text-slate-800',
};

export const CATEGORY_LABEL: Record<string, string> = {
  oversharing: 'Oversharing',
  labelling: 'Labelling',
  identity: 'Identity',
  readiness: 'Copilot readiness',
  licensing: 'Licensing',
  adoption: 'Adoption',
  capability: 'Capability',
  spend: 'Spend',
  value: 'Value',
  policy: 'Content & policy',
};

export const BREACH_LABEL: Record<string, string> = {
  'anyone-link': 'Anyone link',
  'organization-link': 'Org-wide link',
  'external-guest': 'Guest access',
  'public-site': 'Public site',
  'audience-exceeded': 'Audience too wide',
  'label-missing': 'Label missing',
  'label-insufficient': 'Label too low',
  'location-blocked': 'Blocked location',
  'location-not-allowed': 'Not an approved location',
  'onedrive-not-allowed': 'In OneDrive',
  'department-not-allowed': 'Wrong department',
  'retention-exceeded': 'Past retention',
};

export const bytes = (n: number) => {
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${num(Math.round(v * 10) / 10)} ${units[i]}`;
};

/** Plain-language "who can open this file" from a classified file's exposure. */
export function accessSummary(e: {
  anyoneLinks: number;
  organizationLinks: number;
  externalPrincipals: number;
  publicSite: boolean;
  audienceSize: number | null;
}): string {
  const parts: string[] = [];
  if (e.anyoneLinks)
    parts.push(`anyone with the link (${e.anyoneLinks} link${e.anyoneLinks > 1 ? 's' : ''})`);
  if (e.organizationLinks) parts.push('everyone in the organisation (org-wide link)');
  if (e.publicSite) parts.push('everyone in the organisation (public site)');
  if (e.externalPrincipals)
    parts.push(`${e.externalPrincipals} external guest${e.externalPrincipals > 1 ? 's' : ''}`);
  if (e.audienceSize !== null) parts.push(`~${e.audienceSize} people with access`);
  return parts.length ? parts.join('; ') : 'site members only';
}
