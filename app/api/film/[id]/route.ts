import { allowed, clientIp } from "@/lib/ratelimit";
import { filmDetail } from "@/lib/tmdb";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^\d{1,9}$/.test(id)) return Response.json({ error: "Not found." }, { status: 404 });
  if (!(await allowed("film", clientIp(req)))) return Response.json({ error: "Slow down." }, { status: 429 });
  try {
    const detail = await filmDetail(Number(id));
    return Response.json(detail, { headers: { "cache-control": "public, s-maxage=604800, stale-while-revalidate=86400" } });
  } catch {
    return Response.json({ error: "Not available." }, { status: 502 });
  }
}
