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
};
