import { timingSafeEqual } from "node:crypto";
import { admin } from "@/lib/admin";

export const dynamic = "force-dynamic";
export const maxDuration = 10;

const KEEP_DAYS = 3;

function authorised(req: Request): boolean {
  const given = Buffer.from(req.headers.get("authorization") ?? "");
  const expected = Buffer.from(`Bearer ${process.env.CRON_SECRET}`);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

// Daily. Removes old sessions and their anonymous logins, and the query also keeps a
// free Supabase project from pausing for inactivity.
export async function GET(req: Request) {
  if (!process.env.CRON_SECRET || !authorised(req)) return new Response("Unauthorised", { status: 401 });
  const cutoff = new Date(Date.now() - KEEP_DAYS * 86_400_000).toISOString();
  const db = admin();
  const { error, count } = await db.from("sessions").delete({ count: "exact" }).lt("created_at", cutoff);
  if (error) return Response.json({ error: error.message }, { status: 500 });

  await db.from("rate_hits").delete().lt("expires_at", new Date().toISOString());

  let users = 0;
  const { data } = await db.auth.admin.listUsers({ perPage: 1000 });
  for (const user of data?.users ?? []) {
    if (user.is_anonymous && user.created_at < cutoff) {
      await db.auth.admin.deleteUser(user.id);
      users++;
    }
  }
  return Response.json({ sessions: count ?? 0, users });
}
