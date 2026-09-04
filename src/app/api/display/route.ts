import { NextResponse } from "next/server";
import { z } from "zod";
import { ApiError } from "@/lib/errors";
import { callFunction } from "@/lib/server/rpc";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({ token: z.string().min(16).max(64).regex(/^[A-Za-z0-9_-]+$/) });

/** Read-only table display snapshot. No device identity required. */
export async function POST(req: Request): Promise<NextResponse> {
  let token: string;
  try {
    token = schema.parse(await req.json()).token;
  } catch {
    return NextResponse.json({ error: "ARG_INVALID" }, { status: 400 });
  }
  try {
    const result = await callFunction("get_display_snapshot", { p_display_token: token });
    return NextResponse.json({ result }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    const code = err instanceof ApiError ? err.code : "NETWORK";
    return NextResponse.json({ error: code }, { status: code === "NETWORK" ? 502 : 400 });
  }
}
