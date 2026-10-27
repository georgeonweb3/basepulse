/* global Response */
// Server-side proxy for the BasePulse Trust API.
// The Render API sends no CORS headers, so browsers can't call it directly.
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const API = process.env.TRUST_API_URL || "https://basepulse-trust.onrender.com";

export async function GET(_req, { params }) {
  const { address } = await params;
  if (!/^0x[0-9a-fA-F]{40}$/.test(address || "")) {
    return Response.json({ error: "invalid address" }, { status: 400 });
  }
  try {
    const res = await fetch(`${API}/score/${address}`, {
      signal: AbortSignal.timeout(55000), // Render free tier can take ~50s to wake
      cache: "no-store",
    });
    if (!res.ok) return Response.json({ error: `upstream ${res.status}` }, { status: 502 });
    const data = await res.json();
    return Response.json(data, { headers: { "Cache-Control": "s-maxage=300, stale-while-revalidate=600" } });
  } catch {
    return Response.json({ error: "trust api unavailable" }, { status: 504 });
  }
}
