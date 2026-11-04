import type { NextConfig } from "next";

const supabase = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "https://*.supabase.co";
const realtime = supabase.replace(/^http/, "ws");
const dev = process.env.NODE_ENV !== "production";

const nextConfig: NextConfig = {
  turbopack: { root: __dirname },
  poweredByHeader: false,
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
          { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
          {
            key: "Content-Security-Policy",
            value: [
              "default-src 'self'",
              "img-src 'self' https://image.tmdb.org data:",
              `connect-src 'self' ${supabase} ${realtime}`,
              `script-src 'self' 'unsafe-inline'${dev ? " 'unsafe-eval'" : ""}`,
              "style-src 'self' 'unsafe-inline'",
              "font-src 'self'",
              "frame-ancestors 'none'",
              "base-uri 'self'",
              "form-action 'self'",
              "object-src 'none'",
            ].join("; "),
          },
        ],
      },
    ];
  },
};

export default nextConfig;
