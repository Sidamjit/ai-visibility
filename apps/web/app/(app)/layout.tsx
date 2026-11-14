import Link from 'next/link';
import type { ReactNode } from 'react';
import { BRAND, canAccess } from '@aiv/core';
import { requireUser } from '@/lib/auth';
import { getTenant } from '@/lib/data';
import { SignOutButton } from './SignOutButton';

export const dynamic = 'force-dynamic';

const NAV = [
  { href: '/executive', label: 'Executive overview' },
  { href: '/it', label: 'ICT dashboard' },
  { href: '/it/remediation', label: 'Remediation checklist' },
  { href: '/manager', label: 'Team adoption' },
  { href: '/recommendations', label: 'Recommendations' },
  { href: '/report', label: 'Full report' },
  { href: '/connectors', label: 'Connectors' },
  { href: '/settings/assumptions', label: 'Value assumptions' },
];

/** Authenticated app shell: sidebar navigation filtered by role. */
export default async function AppLayout({ children }: { children: ReactNode }) {
  const user = await requireUser();
  const tenant = await getTenant(user.tenantId);
  const items = NAV.filter((n) => canAccess(user.role, n.href));
  return (
    <div className="flex min-h-screen">
      <aside className="flex w-60 shrink-0 flex-col bg-slate-900 text-slate-200 print:hidden">
        <div className="px-5 py-5">
          <div className="text-[10px] font-semibold uppercase tracking-widest text-sky-400">
            {BRAND.vendorName}
          </div>
          <div className="text-lg font-bold text-white">{BRAND.productName}</div>
          <div className="mt-1 truncate text-xs text-slate-400">{tenant.name}</div>
        </div>
        <nav className="flex-1 space-y-0.5 px-3">
          {items.map((n) => (
            <Link
              key={n.href}
              href={n.href}
              className="block rounded-md px-3 py-2 text-sm hover:bg-slate-800 hover:text-white"
            >
              {n.label}
            </Link>
          ))}
        </nav>
        <div className="border-t border-slate-800 px-5 py-4 text-xs">
          <div className="font-medium text-white">{user.name}</div>
          <div className="text-slate-400">
            {user.role}
            {user.department ? ` · ${user.department}` : ''}
          </div>
          <SignOutButton />
        </div>
      </aside>
      <main className="min-w-0 flex-1 p-8">{children}</main>
    </div>
  );
}
