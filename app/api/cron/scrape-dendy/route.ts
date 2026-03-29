import { NextRequest, NextResponse } from "next/server";
import { scrapeDendy } from "@/lib/dendy";

export async function GET(req: NextRequest) {
  const secret = req.headers.get("x-cron-secret");
  if (secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const apiKey = process.env.NEXT_PUBLIC_TMDB_API_KEY ?? "";
  await scrapeDendy(apiKey);

  return NextResponse.json({ ok: true, scraped: new Date().toISOString() });
}
