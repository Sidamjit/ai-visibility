import { prisma } from '@aiv/db';

export const dynamic = 'force-dynamic';

/** Liveness/readiness probe for Docker / load balancers. */
export async function GET() {
  try {
    await prisma.tenant.count();
    return Response.json({ ok: true });
  } catch {
    return Response.json({ ok: false }, { status: 503 });
  }
}
