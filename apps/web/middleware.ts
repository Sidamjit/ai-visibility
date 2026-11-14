/**
 * Route protection. Unauthenticated users go to /login; authenticated users
 * without the role for a route (see ROUTE_ACCESS in @aiv/core) go to their home.
 */
import { withAuth } from 'next-auth/middleware';
import { NextResponse } from 'next/server';
import { HOME_FOR_ROLE, canAccess, isRole } from '@aiv/core';

export default withAuth(
  function middleware(req) {
    const token = req.nextauth.token;
    const role = token?.role;
    if (!isRole(role)) return NextResponse.redirect(new URL('/login', req.url));
    // Vendor sessions end at grant expiry (revocation is enforced server-side per request).
    if (role === 'VENDOR_SUPPORT' && (!token?.grantExpiresAt || token.grantExpiresAt < Date.now()))
      return NextResponse.redirect(new URL('/login?error=VendorAccessEnded', req.url));
    if (!canAccess(role, req.nextUrl.pathname, token?.vendorScope ?? null))
      return NextResponse.redirect(new URL(HOME_FOR_ROLE[role], req.url));
    // Pages read this for role checks and the page-view audit log.
    const headers = new Headers(req.headers);
    headers.set('x-aiv-pathname', req.nextUrl.pathname);
    return NextResponse.next({ request: { headers } });
  },
  { pages: { signIn: '/login' } },
);

export const config = {
  // Everything except auth endpoints, health check, login page and static assets.
  matcher: ['/((?!api/auth|api/health|login|_next/static|_next/image|favicon.ico).*)'],
};
