import { NextRequest, NextResponse } from "next/server";
import { Resend } from "resend";
import { createClient } from "@supabase/supabase-js";

const resend = new Resend(process.env.RESEND_API_KEY);

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

const TAG_LABELS: Record<string, string> = {
  feature: "Feature Request",
  bug:     "Bug Report",
  other:   "Other",
};

export async function POST(req: NextRequest) {
  const { tag, otherLabel, message, email } = await req.json();

  if (!tag || !message?.trim()) {
    return NextResponse.json({ error: "Missing fields" }, { status: 400 });
  }

  // Save to Supabase
  const { error: dbError } = await supabase
    .from("feedback")
    .insert({ tag, message: message.trim(), sender_email: email?.trim() || null });

  if (dbError) {
    console.error("feedback insert error", dbError);
    return NextResponse.json({ error: "DB error" }, { status: 500 });
  }

  // Subject: use custom otherLabel if provided, otherwise fall back to tag label
  const subjectTag = tag === "other" && otherLabel?.trim()
    ? otherLabel.trim()
    : (TAG_LABELS[tag] ?? tag);

  const replyLine = email?.trim() ? `<p style="color:#999;font-size:12px;margin:0 0 24px">${email.trim()}</p>` : "";
  const safe = (s: string) => s.replace(/</g, "&lt;").replace(/>/g, "&gt;");

  await resend.emails.send({
    from:    "Filmclub <feedback@filmclub.watch>",
    to:      "owner@example.com",
    subject: `[Filmclub] ${subjectTag}`,
    html: `
      <div style="font-family:sans-serif;max-width:560px;margin:0 auto;padding:40px 24px;background:#ffffff">
        <img src="https://filmclub.watch/logo.png" width="40" height="40" alt="Filmclub" style="display:block;margin-bottom:20px" />
        <h2 style="margin:0 0 4px;font-size:18px;font-weight:600;color:#111111">${safe(subjectTag)}</h2>
        ${replyLine}
        <div style="background:#f5f5f5;border-radius:10px;padding:20px;white-space:pre-wrap;font-size:14px;line-height:1.8;color:#333333;margin-top:${replyLine ? "0" : "20px"}">
          ${safe(message.trim())}
        </div>
        <p style="color:#cccccc;font-size:11px;margin:24px 0 0">filmclub.watch</p>
      </div>
    `,
  });

  return NextResponse.json({ ok: true });
}
