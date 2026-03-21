import { NextRequest, NextResponse } from "next/server";
import { getDendySessions } from "@/lib/dendy";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const date = searchParams.get("date");
  const from = searchParams.get("from") ?? undefined;
  const to = searchParams.get("to") ?? undefined;

  if (!date) {
    return NextResponse.json({ error: "date required (YYYY-MM-DD)" }, { status: 400 });
  }

  const sessions = await getDendySessions(date, from, to);
  return NextResponse.json({ sessions });
}
