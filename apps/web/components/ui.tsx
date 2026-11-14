/**
 * Presentational building blocks (server-component safe: no hooks, no state).
 * Keep visual conventions here so pages stay readable.
 */
import Link from 'next/link';
import type { ReactNode } from 'react';
import { SEVERITY_STYLE } from '@/lib/format';

export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">{title}</h1>
        {subtitle ? <p className="mt-1 text-sm text-slate-500">{subtitle}</p> : null}
      </div>
      {actions ? <div className="flex gap-2 print:hidden">{actions}</div> : null}
    </div>
  );
}

export function Card({
  title,
  children,
  className = '',
  action,
}: {
  title?: ReactNode;
  children: ReactNode;
  className?: string;
  action?: ReactNode;
}) {
  return (
    <section className={`rounded-xl border border-slate-200 bg-white p-5 shadow-sm ${className}`}>
      {title ? (
        <div className="mb-3 flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">{title}</h2>
          {action}
        </div>
      ) : null}
      {children}
    </section>
  );
}

export function Kpi({
  label,
  value,
  hint,
  tone = 'default',
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  tone?: 'default' | 'bad' | 'good' | 'warn';
}) {
  const color = {
    default: 'text-slate-900',
    bad: 'text-red-600',
    good: 'text-emerald-600',
    warn: 'text-amber-600',
  }[tone];
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</div>
      <div className={`mt-1 text-2xl font-semibold ${color}`}>{value}</div>
      {hint ? <div className="mt-1 text-xs text-slate-500">{hint}</div> : null}
    </div>
  );
}

export function SeverityBadge({ severity }: { severity: string }) {
  return (
    <span
      className={`inline-block shrink-0 self-start whitespace-nowrap rounded px-2 py-0.5 text-xs font-semibold capitalize ${SEVERITY_STYLE[severity] ?? SEVERITY_STYLE.info}`}
    >
      {severity}
    </span>
  );
}

export function Pill({
  children,
  tone = 'slate',
}: {
  children: ReactNode;
  tone?: 'slate' | 'green' | 'red' | 'amber' | 'blue';
}) {
  const cls = {
    slate: 'bg-slate-100 text-slate-700',
    green: 'bg-emerald-100 text-emerald-800',
    red: 'bg-red-100 text-red-800',
    amber: 'bg-amber-100 text-amber-800',
    blue: 'bg-sky-100 text-sky-800',
  }[tone];
  return (
    <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${cls}`}>
      {children}
    </span>
  );
}

/**
 * Circular score gauge (0-100). `invert` = higher is worse (risk), which flips the colours.
 */
export function ScoreRing({
  score,
  label,
  invert = false,
  size = 120,
}: {
  score: number;
  label: string;
  invert?: boolean;
  size?: number;
}) {
  const r = 52;
  const c = 2 * Math.PI * r;
  const good = invert ? score < 35 : score >= 65;
  const bad = invert ? score >= 65 : score < 35;
  const color = good ? '#059669' : bad ? '#dc2626' : '#d97706';
  return (
    <div className="flex flex-col items-center">
      <svg
        width={size}
        height={size}
        viewBox="0 0 120 120"
        role="img"
        aria-label={`${label}: ${score} out of 100`}
      >
        <circle cx="60" cy="60" r={r} fill="none" stroke="#e2e8f0" strokeWidth="12" />
        <circle
          cx="60"
          cy="60"
          r={r}
          fill="none"
          stroke={color}
          strokeWidth="12"
          strokeLinecap="round"
          strokeDasharray={`${(score / 100) * c} ${c}`}
          transform="rotate(-90 60 60)"
        />
        <text x="60" y="66" textAnchor="middle" fontSize="28" fontWeight="700" fill="#0f172a">
          {score}
        </text>
      </svg>
      <div className="mt-1 text-sm font-medium text-slate-600">{label}</div>
    </div>
  );
}

export function ProgressBar({
  value,
  tone = 'blue',
}: {
  value: number;
  tone?: 'blue' | 'green' | 'red' | 'amber';
}) {
  const color = {
    blue: 'bg-sky-500',
    green: 'bg-emerald-500',
    red: 'bg-red-500',
    amber: 'bg-amber-500',
  }[tone];
  return (
    <div className="h-2 w-full overflow-hidden rounded bg-slate-100">
      <div
        className={`h-full ${color}`}
        style={{ width: `${Math.max(0, Math.min(100, value))}%` }}
      />
    </div>
  );
}

export function EmptyState({
  title,
  body,
  href,
  cta,
}: {
  title: string;
  body: string;
  href?: string;
  cta?: string;
}) {
  return (
    <div className="rounded-xl border border-dashed border-slate-300 bg-white p-10 text-center">
      <h2 className="text-lg font-semibold text-slate-800">{title}</h2>
      <p className="mx-auto mt-2 max-w-lg text-sm text-slate-500">{body}</p>
      {href && cta ? (
        <Link
          href={href}
          className="mt-4 inline-block rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white"
        >
          {cta}
        </Link>
      ) : null}
    </div>
  );
}

export function ButtonLink({
  href,
  children,
  variant = 'secondary',
}: {
  href: string;
  children: ReactNode;
  variant?: 'primary' | 'secondary';
}) {
  const cls =
    variant === 'primary'
      ? 'bg-slate-900 text-white hover:bg-slate-700'
      : 'border border-slate-300 bg-white text-slate-700 hover:bg-slate-50';
  return (
    <Link href={href} className={`rounded-lg px-3 py-2 text-sm font-medium ${cls}`}>
      {children}
    </Link>
  );
}
