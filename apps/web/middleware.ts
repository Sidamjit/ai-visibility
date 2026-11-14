/**
 * Route protection. Unauthenticated users go to /login; authenticated users
 * without the role for a route (see ROUTE_ACCESS in @aiv/core) go to their home.
 */
import { withAuth } from 'next-auth/middleware';
import { NextResponse } from 'next/server';
import { HOME_FOR_ROLE, canAccess, isRole } from '@aiv/core';

export default withAuth(
  function middleware(req) {
    const role = req.nextauth.token?.role;
    if (!isRole(role)) return NextResponse.redirect(new URL('/login', req.url));
    if (!canAccess(role, req.nextUrl.pathname))
      return NextResponse.redirect(new URL(HOME_FOR_ROLE[role], req.url));
    return NextResponse.next();
  },
  { pages: { signIn: '/login' } },
);

export const config = {
  // Everything except auth endpoints, health check, login page and static assets.
  matcher: ['/((?!api/auth|api/health|login|_next/static|_next/image|favicon.ico).*)'],
};
