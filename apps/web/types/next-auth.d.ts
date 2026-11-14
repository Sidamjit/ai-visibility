/** Extends NextAuth types with our tenant + role claims. */
import type { Role } from '@aiv/core';
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
    };
  }
  interface User {
    role?: Role;
    tenantId?: string;
    department?: string | null;
  }
}

declare module 'next-auth/jwt' {
  interface JWT {
    uid?: string;
    role?: Role;
    tenantId?: string;
    department?: string | null;
  }
}
