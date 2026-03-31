import { NextResponse } from "next/server";

import { jsonError } from "@/lib/api/errors";
import {
  createGuestSessionWithCookie,
  guestUsageFromRow,
  validateGuestRawToken,
  parseGuestRawCookie,
} from "@/lib/api/request-context";

export async function GET(req: Request) {
  const row = await validateGuestRawToken(parseGuestRawCookie(req.headers.get("cookie")));
  if (!row) {
    return jsonError(404, "Guest session not found", "guest_not_found");
  }
  return NextResponse.json(guestUsageFromRow(row));
}

export async function POST() {
  try {
    const { usage, setCookie } = await createGuestSessionWithCookie();
    return NextResponse.json(usage, {
      status: 201,
      headers: { "Set-Cookie": setCookie },
    });
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    console.error("[POST /api/guest/session]", detail);
    const hint =
      "Usually: Supabase is misconfigured (.env), SUPABASE_SERVICE_ROLE_KEY is wrong, or SQL from supabase/migrations/001_initial.sql was not applied (missing guest_sessions table).";
    const message =
      process.env.NODE_ENV === "development" ? `${detail}. ${hint}` : `Could not create guest session. ${hint}`;
    return jsonError(500, message, "guest_create_failed");
  }
}
