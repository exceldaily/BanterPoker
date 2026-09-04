import { NextResponse } from "next/server";
import { z } from "zod";
import { ApiError } from "@/lib/errors";
import { callFunction, invokeAsDevice, isRpcName, registerDevice } from "@/lib/server/rpc";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// DEVELOPMENT ONLY. Lets the simulator act as several fake devices from one
// browser. Hard-disabled in production builds.

const isDev = process.env.NODE_ENV !== "production";

const bodySchema = z.discriminatedUnion("op", [
  z.object({ op: z.literal("mint"), label: z.string().max(60).optional() }),
  z.object({
    op: z.literal("rpc"),
    deviceId: z.string().uuid(),
    secret: z.string().min(20).max(120),
    fn: z.string(),
    args: z.unknown().optional(),
  }),
]);

export async function POST(req: Request): Promise<NextResponse> {
  if (!isDev) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(await req.json());
  } catch {
    return NextResponse.json({ error: "ARG_INVALID" }, { status: 400 });
  }
  try {
    if (body.op === "mint") {
      const d = await registerDevice(body.label ?? "sim device", "banter-poker-simulator");
      return NextResponse.json({ result: d });
    }
    if (!isRpcName(body.fn)) return NextResponse.json({ error: "ARG_INVALID" }, { status: 400 });
    const result = await invokeAsDevice<unknown>({ deviceId: body.deviceId, secret: body.secret }, body.fn, body.args);
    return NextResponse.json({ result });
  } catch (err) {
    const code = err instanceof ApiError ? err.code : "NETWORK";
    return NextResponse.json({ error: code }, { status: 400 });
  }
}

export async function GET(): Promise<NextResponse> {
  if (!isDev) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  // Cheap connectivity probe for the simulator page.
  try {
    await callFunction("get_display_snapshot", { p_display_token: "probe-not-a-real-token-0000" });
  } catch (err) {
    if (err instanceof ApiError && err.code === "GAME_NOT_FOUND") return NextResponse.json({ ok: true });
    return NextResponse.json({ ok: false, error: err instanceof ApiError ? err.code : "NETWORK" });
  }
  return NextResponse.json({ ok: true });
}
