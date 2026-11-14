import { redirect } from 'next/navigation';
import { HOME_FOR_ROLE } from '@aiv/core';
import { requireUser } from '@/lib/auth';

/** Root: send each role to its own dashboard. */
export default async function Home() {
  const user = await requireUser();
  redirect(HOME_FOR_ROLE[user.role]);
}
