/** Extends NextAuth types with our tenant + role claims. */
import type { Role, VendorScope } from '@aiv/core';
import 'next-auth';
import 'next-auth/jwt';

declare module 'next-auth' {
  interface Session {
    user: {
      id: string;
      name: string;
      email: string;
      role: Role;
      tenantId: string;
      department: string | null;
      vendorScope: VendorScope | null;
    };
  }
  interface User {
    role?: Role;
    tenantId?: string;
    department?: string | null;
    vendorScope?: VendorScope | null;
    grantExpiresAt?: number | null;
  }
}

declare module 'next-auth/jwt' {
  interface JWT {
    uid?: string;
    role?: Role;
    tenantId?: string;
    department?: string | null;
    vendorScope?: VendorScope | null;
    /** Epoch ms; vendor sessions end at grant expiry even before the JWT does. */
    grantExpiresAt?: number | null;
  }
}
