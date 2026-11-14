'use client';
import { signOut } from 'next-auth/react';

export function SignOutButton() {
  return (
    <button
      onClick={() => signOut({ callbackUrl: '/login' })}
      className="mt-2 text-sky-400 hover:underline"
    >
      Sign out
    </button>
  );
}
