import { BRAND } from '@aiv/core';
import { ssoEnabled } from '@/lib/auth';
import { LoginForm } from './LoginForm';

export const dynamic = 'force-dynamic';

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  return (
    <main className="flex min-h-screen items-center justify-center bg-gradient-to-br from-slate-900 to-slate-700 p-6">
      <div className="w-full max-w-md rounded-2xl bg-white p-8 shadow-xl">
        <div className="mb-6">
          <div className="text-xs font-semibold uppercase tracking-widest text-sky-600">
            {BRAND.vendorName}
          </div>
          <h1 className="mt-1 text-2xl font-bold text-slate-900">{BRAND.productName}</h1>
          <p className="mt-1 text-sm text-slate-500">{BRAND.tagline}</p>
        </div>
        {error === 'VendorAccessEnded' ? (
          <p className="mb-4 rounded-lg bg-amber-50 p-3 text-sm text-amber-900">
            Vendor support access has ended (expired, revoked or switched off by the organisation).
          </p>
        ) : null}
        <LoginForm sso={ssoEnabled} />
        {process.env.NODE_ENV !== 'production' || process.env.SHOW_DEMO_LOGINS === '1' ? (
          <div className="mt-6 rounded-lg bg-slate-50 p-3 text-xs text-slate-600">
            <div className="font-semibold">
              Demo accounts (password from DEMO_PASSWORD, default demo1234)
            </div>
            <ul className="mt-1 space-y-0.5 font-mono">
              <li>it@demo.local — IT / ICT</li>
              <li>exec@demo.local — Executive</li>
              <li>manager@demo.local — Manager (Finance)</li>
            </ul>
          </div>
        ) : null}
      </div>
    </main>
  );
}
