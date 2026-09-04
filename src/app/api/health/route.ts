import { NextResponse } from "next/server";
import { SUPABASE_ANON_KEY, SUPABASE_URL } from "@/lib/supabase-public";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** OrbitStack health contract: { status, service, checks, timestamp }. */
export async function GET(): Promise<NextResponse> {
  const url = SUPABASE_URL;
  const key = SUPABASE_ANON_KEY;
  const checks: Record<string, { status: "ok" | "error"; detail?: string }> = {};
  checks.env = url && key ? { status: "ok" } : { status: "error", detail: "supabase env missing" };
  if (url && key) {
    try {
      const res = await fetch(`${url}/rest/v1/`, { headers: { apikey: key, "Accept-Profile": "banterpoker" }, cache: "no-store" });
      checks.database = res.ok ? { status: "ok" } : { status: "error", detail: `rest ${res.status}` };
    } catch {
      checks.database = { status: "error", detail: "unreachable" };
    }
  }
  const healthy = Object.values(checks).every((c) => c.status === "ok");
  return NextResponse.json(
    { status: healthy ? "ok" : "degraded", service: "banter-poker", checks, timestamp: new Date().toISOString() },
    { status: healthy ? 200 : 503, headers: { "Cache-Control": "no-store" } },
  );
}
