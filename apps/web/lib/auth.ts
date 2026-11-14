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
 */
import bcrypt from 'bcryptjs';
import { getServerSession, type NextAuthOptions } from 'next-auth';
import CredentialsProvider from 'next-auth/providers/credentials';
import AzureADProvider from 'next-auth/providers/azure-ad';
import { redirect } from 'next/navigation';
import { isRole, type Role } from '@aiv/core';
import { prisma } from '@aiv/db';

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
      if (!ok) return null;
      return {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        tenantId: user.tenantId,
        department: user.department,
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
  callbacks: {
    async signIn({ user, account }) {
      if (account?.provider === 'credentials') return true;
      // SSO: only pre-provisioned users may sign in.
      const email = user.email?.toLowerCase();
      return Boolean(email && (await prisma.appUser.findUnique({ where: { email } })));
    },
    async jwt({ token, user, account }) {
      if (user && account?.provider === 'credentials') {
        token.uid = user.id;
        token.role = user.role;
        token.tenantId = user.tenantId;
        token.department = user.department ?? null;
      } else if (user && account) {
        const appUser = await prisma.appUser.findUnique({
          where: { email: user.email!.toLowerCase() },
        });
        if (appUser && isRole(appUser.role)) {
          token.uid = appUser.id;
          token.role = appUser.role;
          token.tenantId = appUser.tenantId;
          token.department = appUser.department;
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
};

/** Returns the signed-in user or redirects to /login. */
export async function requireUser(): Promise<SessionUser> {
  const session = await getServerSession(authOptions);
  if (!session?.user?.tenantId) redirect('/login');
  return session.user;
}

/** Server-side role gate (defence in depth alongside middleware). */
export async function requireRole(roles: readonly Role[]): Promise<SessionUser> {
  const user = await requireUser();
  if (!roles.includes(user.role)) redirect('/');
  return user;
}
