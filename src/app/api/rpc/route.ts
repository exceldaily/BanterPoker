import { NextResponse } from "next/server";
import { ApiError } from "@/lib/errors";
import {
  DEVICE_COOKIE,
  cookieOptions,
  currentDevice,
  invokeAsDevice,
  isRpcName,
  registerDevice,
  serializeDeviceCookie,
} from "@/lib/server/rpc";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RpcRequest {
  fn?: unknown;
  args?: unknown;
}

function errorResponse(err: unknown): NextResponse {
  if (err instanceof ApiError) {
    const status = err.code === "DEVICE_INVALID" ? 401 : err.code === "RATE_LIMITED" ? 429 : 400;
    return NextResponse.json({ error: err.code }, { status, headers: { "Cache-Control": "no-store" } });
  }
  console.error("[rpc] unexpected error", err);
  return NextResponse.json({ error: "NETWORK" }, { status: 502, headers: { "Cache-Control": "no-store" } });
}

export async function POST(req: Request): Promise<NextResponse> {
  let body: RpcRequest;
  try {
    body = (await req.json()) as RpcRequest;
  } catch {
    return NextResponse.json({ error: "ARG_INVALID" }, { status: 400 });
  }
  const fn = typeof body.fn === "string" ? body.fn : "";
  if (!isRpcName(fn)) {
    return NextResponse.json({ error: "ARG_INVALID" }, { status: 400 });
  }

  let device = await currentDevice();
  let setCookie: string | null = null;
  if (!device) {
    try {
      device = await registerDevice(null, req.headers.get("user-agent"));
      setCookie = serializeDeviceCookie(device);
    } catch (err) {
      return errorResponse(err);
    }
  }

  try {
    const result = await invokeAsDevice<unknown>(device, fn, body.args);
    const res = NextResponse.json({ result }, { headers: { "Cache-Control": "no-store, private" } });
    if (setCookie) res.cookies.set(DEVICE_COOKIE, setCookie, cookieOptions());
    return res;
  } catch (err) {
    if (err instanceof ApiError && err.code === "DEVICE_INVALID" && !setCookie) {
      // Stale cookie (device row gone). Mint a fresh identity so the user can carry on.
      try {
        const fresh = await registerDevice(null, req.headers.get("user-agent"));
        const res = NextResponse.json({ error: "DEVICE_INVALID", reset: true }, { status: 401 });
        res.cookies.set(DEVICE_COOKIE, serializeDeviceCookie(fresh), cookieOptions());
        return res;
      } catch (inner) {
        return errorResponse(inner);
      }
    }
    return errorResponse(err);
  }
}
