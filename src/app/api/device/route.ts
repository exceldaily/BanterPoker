import { NextResponse } from "next/server";
import { ApiError } from "@/lib/errors";
import {
  DEVICE_COOKIE,
  cookieOptions,
  currentDevice,
  registerDevice,
  serializeDeviceCookie,
  callFunction,
} from "@/lib/server/rpc";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Ensures this browser has a device identity (httpOnly cookie) and returns the
 * games it can reconnect to. Called on app load and on reconnect.
 */
export async function POST(req: Request): Promise<NextResponse> {
  let device = await currentDevice();
  let minted = false;
  try {
    if (!device) {
      device = await registerDevice(null, req.headers.get("user-agent"));
      minted = true;
    }
    let games: unknown = [];
    try {
      games = await callFunction("my_games", { p_device_id: device.deviceId, p_secret: device.secret });
    } catch (err) {
      if (err instanceof ApiError && err.code === "DEVICE_INVALID") {
        device = await registerDevice(null, req.headers.get("user-agent"));
        minted = true;
        games = [];
      } else {
        throw err;
      }
    }
    const res = NextResponse.json(
      { deviceId: device.deviceId, games },
      { headers: { "Cache-Control": "no-store, private" } },
    );
    if (minted) res.cookies.set(DEVICE_COOKIE, serializeDeviceCookie(device), cookieOptions());
    return res;
  } catch (err) {
    const code = err instanceof ApiError ? err.code : "NETWORK";
    return NextResponse.json({ error: code }, { status: code === "NETWORK" ? 502 : 400 });
  }
}
