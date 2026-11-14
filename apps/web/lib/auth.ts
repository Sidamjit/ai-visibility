/**
 * Authentication for the app itself (NextAuth v4, JWT sessions).
 *
 *  - Credentials provider: email + bcrypt password stored in AppUser.
 *  - Optional Microsoft Entra ID SSO: enabled when AZURE_AD_* env vars are set.
 *    SSO users must ALSO exist in AppUser (that is where their role and tenant
 *    come from); unknown SSO users are rejected.
 *
 * Authorization: role claims are checked in middleware.ts (route prefixes) AND
 * server-side in every page via `requireRole()`.
 *
 * Vendor support (VENDOR_SUPPORT): may sign in ONLY while the client has an
 * active, unexpired VendorAccessGrant (and the tenant switch is on). The grant
 * is re-read from the database on every page render and server action, so
 * revoking it ends access immediately. Vendors never pass a write check.
 *
 * Audit: sign-ins, page views (every requireRole call) and exports are written
 * to the tenant's audit log (Settings → Audit log).
 */
import bcrypt from 'bcryptjs';
import { getServerSession, type NextAuthOptions } from 'next-auth';
import CredentialsProvider from 'next-auth/providers/credentials';
import AzureADProvider from 'next-auth/providers/azure-ad';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { canAccess, isRole, type Role, type VendorScope } from '@aiv/core';
import { prisma } from '@aiv/db';
import { activeVendorGrant, audit } from '@aiv/pipeline';

const providers: NextAuthOptions['providers'] = [
  CredentialsProvider({
    name: 'Email and password',
    credentials: {
      email: { label: 'Email', type: 'email' },
      password: { label: 'Password', type: 'password' },
    },
    async authorize(credentials) {
      const email = credentials?.email?.toLowerCase().trim();
      if (!email || !credentials?.password) return null;
      const user = await prisma.appUser.findUnique({ where: { email } });
      if (!user?.passwordHash || !isRole(user.role)) return null;
      const ok = await bcrypt.compare(credentials.password, user.passwordHash);
      if (!ok) {
        await audit({
          tenantId: user.tenantId,
          actor: email,
          actorRole: user.role,
          action: 'auth.login.failed',
        });
        return null;
      }
      let vendorScope: VendorScope | null = null;
      let grantExpiresAt: number | null = null;
      if (user.role === 'VENDOR_SUPPORT') {
        const grant = await activeVendorGrant(user.id);
        if (!grant) {
          await audit({
            tenantId: user.tenantId,
            actor: email,
            actorRole: user.role,
            action: 'auth.vendor.denied',
            detail: { reason: 'no active grant' },
          });
          return null;
        }
        vendorScope = grant.scope as VendorScope;
        grantExpiresAt = grant.expiresAt.getTime();
      }
      return {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        tenantId: user.tenantId,
        department: user.department,
        vendorScope,
        grantExpiresAt,
      };
    },
  }),
];

if (
  process.env.AZURE_AD_CLIENT_ID &&
  process.env.AZURE_AD_CLIENT_SECRET &&
  process.env.AZURE_AD_TENANT_ID
) {
  providers.push(
    AzureADProvider({
      clientId: process.env.AZURE_AD_CLIENT_ID,
      clientSecret: process.env.AZURE_AD_CLIENT_SECRET,
      tenantId: process.env.AZURE_AD_TENANT_ID,
    }),
  );
}

export const ssoEnabled = providers.length > 1;

export const authOptions: NextAuthOptions = {
  providers,
  session: { strategy: 'jwt', maxAge: 8 * 60 * 60 },
  pages: { signIn: '/login' },
  events: {
    async signIn({ user }) {
      const appUser = user.email
        ? await prisma.appUser.findUnique({ where: { email: user.email.toLowerCase() } })
        : null;
      if (appUser)
        await audit({
          tenantId: appUser.tenantId,
          actor: appUser.email,
          actorRole: appUser.role,
          action: appUser.role === 'VENDOR_SUPPORT' ? 'auth.vendor.login' : 'auth.login',
        });
    },
  },
  callbacks: {
    async signIn({ user, account }) {
      if (account?.provider === 'credentials') return true;
      // SSO: only pre-provisioned users may sign in; vendors only with an active grant.
      const email = user.email?.toLowerCase();
      const appUser = email ? await prisma.appUser.findUnique({ where: { email } }) : null;
      if (!appUser) return false;
      if (appUser.role === 'VENDOR_SUPPORT') return Boolean(await activeVendorGrant(appUser.id));
      return true;
    },
    async jwt({ token, user, account }) {
      if (user && account?.provider === 'credentials') {
        token.uid = user.id;
        token.role = user.role;
        token.tenantId = user.tenantId;
        token.department = user.department ?? null;
        token.vendorScope = user.vendorScope ?? null;
        token.grantExpiresAt = user.grantExpiresAt ?? null;
      } else if (user && account) {
        const appUser = await prisma.appUser.findUnique({
          where: { email: user.email!.toLowerCase() },
        });
        if (appUser && isRole(appUser.role)) {
          token.uid = appUser.id;
          token.role = appUser.role;
          token.tenantId = appUser.tenantId;
          token.department = appUser.department;
          if (appUser.role === 'VENDOR_SUPPORT') {
            const grant = await activeVendorGrant(appUser.id);
            token.vendorScope = (grant?.scope as VendorScope | undefined) ?? null;
            token.grantExpiresAt = grant?.expiresAt.getTime() ?? 0;
          }
        }
      }
      return token;
    },
    async session({ session, token }) {
      session.user = {
        id: token.uid ?? '',
        name: token.name ?? '',
        email: token.email ?? '',
        role: token.role ?? 'MANAGER',
        tenantId: token.tenantId ?? '',
        department: token.department ?? null,
        vendorScope: token.vendorScope ?? null,
      };
      return session;
    },
  },
};

export type SessionUser = {
  id: string;
  name: string;
  email: string;
  role: Role;
  tenantId: string;
  department: string | null;
  vendorScope: VendorScope | null;
};

/** Returns the signed-in user or redirects to /login. Vendors are re-checked against their grant. */
export async function requireUser(): Promise<SessionUser> {
  const session = await getServerSession(authOptions);
  if (!session?.user?.tenantId) redirect('/login');
  const user = session.user;
  if (user.role === 'VENDOR_SUPPORT') {
    const grant = await activeVendorGrant(user.id);
    if (!grant || grant.tenantId !== user.tenantId) redirect('/login?error=VendorAccessEnded');
    return { ...user, vendorScope: grant.scope as VendorScope };
  }
  return { ...user, vendorScope: null };
}

async function currentPath(): Promise<string | null> {
  return (await headers()).get('x-aiv-pathname');
}

/**
 * Server-side role gate (defence in depth alongside middleware) + page-view audit.
 *
 * `write: true` for server actions / mutations: the vendor role never passes.
 * For reads, a vendor passes when their grant scope opens the current path.
 */
export async function requireRole(
  roles: readonly Role[],
  opts: { write?: boolean; audit?: boolean } = {},
): Promise<SessionUser> {
  const user = await requireUser();
  const path = await currentPath();
  const vendorRead =
    user.role === 'VENDOR_SUPPORT' &&
    !opts.write &&
    path !== null &&
    canAccess(user.role, path, user.vendorScope);
  if (!roles.includes(user.role) && !vendorRead) redirect('/');
  if (opts.write && user.role === 'VENDOR_SUPPORT') redirect('/');
  if (!opts.write && opts.audit !== false && path)
    await audit({
      tenantId: user.tenantId,
      actor: user.email,
      actorRole: user.role,
      action: 'page.view',
      target: path,
    });
  return user;
}

/** For server actions: only these roles, never the vendor. */
export const WRITE = { write: true } as const;
