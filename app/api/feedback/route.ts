import { NextRequest, NextResponse } from "next/server";
import { Resend } from "resend";
import { createClient } from "@supabase/supabase-js";
import { checkRateLimit } from "@/lib/ratelimit";

const resend = new Resend(process.env.RESEND_API_KEY);

// Use service role key explicitly — no fallback to anon. If the service role
// is missing in env, fail loudly rather than silently degrading to anon-key
// behaviour where the feedback table insert would be RLS-rejected (#48).
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

const TAG_LABELS: Record<string, string> = {
  feature: "Feature Request",
  bug:     "Bug Report",
  other:   "Other",
};

// Server-side validation caps. Client-side `maxLength` is bypassable via curl
// so these guard the actual endpoint (#55).
const MAX_MESSAGE_LENGTH = 2000;
const MAX_EMAIL_LENGTH   = 254; // RFC 5321
const MAX_OTHER_LABEL_LENGTH = 60;

export async function POST(req: NextRequest) {
  // #47: rate-limit before parsing body — cheap deny for spam floods.
  // No-op when UPSTASH_REDIS_REST_URL/_TOKEN are unset (see lib/ratelimit.ts).
  const rl = await checkRateLimit("feedback", req);
  if (!rl.allowed) {
    return NextResponse.json({ error: "Too many submissions. Try again later." }, { status: 429 });
  }

  const { tag, otherLabel, message, email } = await req.json();

  if (!tag || !message?.trim()) {
    return NextResponse.json({ error: "Missing fields" }, { status: 400 });
  }

  if (typeof message !== "string" || message.length > MAX_MESSAGE_LENGTH) {
    return NextResponse.json({ error: "Message too long" }, { status: 400 });
  }
  if (email && (typeof email !== "string" || email.length > MAX_EMAIL_LENGTH)) {
    return NextResponse.json({ error: "Invalid email" }, { status: 400 });
  }
  if (otherLabel && (typeof otherLabel !== "string" || otherLabel.length > MAX_OTHER_LABEL_LENGTH)) {
    return NextResponse.json({ error: "Label too long" }, { status: 400 });
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

  // Create GitHub issue
  const githubToken = process.env.GITHUB_TOKEN;
  if (githubToken) {
    const issueTitle = `[${subjectTag}] ${message.trim().slice(0, 60)}${message.trim().length > 60 ? "…" : ""}`;
    // Email is delivered via Resend below — no need to also embed it in the
    // GitHub issue body. Even though the repo is private (so the email isn't
    // externally exposed) keeping issue bodies clean of PII is the right
    // default in case the repo ever opens (#42).
    const issueBody = message.trim();

    await fetch("https://api.github.com/repos/Maltysnack/Filmclub/issues", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${githubToken}`,
        Accept: "application/vnd.github+json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        title: issueTitle,
        body: issueBody,
        labels: [tag],
      }),
    });
  }

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
