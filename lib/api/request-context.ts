import type { User } from "@supabase/supabase-js";

import {
  GUEST_FREE_QUESTIONS_LIMIT,
  GUEST_SESSION_COOKIE,
  GUEST_SESSION_MAX_AGE_SEC,
} from "@/lib/constants";
import { hashToken, randomSecret } from "@/lib/crypto-token";
import type { GuestUsage } from "@/lib/guest-usage";
import { createAdminClient } from "@/lib/supabase/admin";

export type { GuestUsage } from "@/lib/guest-usage";

export type GuestSessionRow = {
  id: string;
  token_hash: string;
  free_questions_used: number;
  free_questions_limit: number;
};

export type Caller = { kind: "user"; user: User } | { kind: "guest"; guest: GuestSessionRow };

export async function getUserFromBearer(authHeader: string | null): Promise<User | null> {
  if (!authHeader?.startsWith("Bearer ")) return null;
  const jwt = authHeader.slice(7).trim();
  if (!jwt) return null;
  const admin = createAdminClient();
  const { data, error } = await admin.auth.getUser(jwt);
  if (error || !data.user) return null;
  return data.user;
}

export function parseGuestRawCookie(cookieHeader: string | null): string | null {
  if (!cookieHeader) return null;
  const parts = cookieHeader.split(";").map((p) => p.trim());
  for (const p of parts) {
    if (p.startsWith(`${GUEST_SESSION_COOKIE}=`)) {
      return decodeURIComponent(p.slice(GUEST_SESSION_COOKIE.length + 1));
    }
  }
  return null;
}

export async function validateGuestRawToken(raw: string | null): Promise<GuestSessionRow | null> {
  if (!raw) return null;
  const dot = raw.indexOf(".");
  if (dot <= 0) return null;
  const sessionId = raw.slice(0, dot);
  const secret = raw.slice(dot + 1);
  if (!sessionId || !secret) return null;

  const admin = createAdminClient();
  const { data: row, error } = await admin
    .from("guest_sessions")
    .select("id, token_hash, free_questions_used, free_questions_limit")
    .eq("id", sessionId)
    .maybeSingle();

  if (error || !row) return null;
  const expected = hashToken(secret);
  if (expected !== row.token_hash) return null;

  await admin
    .from("guest_sessions")
    .update({ last_seen_at: new Date().toISOString() })
    .eq("id", row.id);

  return row as GuestSessionRow;
}

export async function resolveCaller(req: Request): Promise<Caller | null> {
  const user = await getUserFromBearer(req.headers.get("authorization"));
  if (user) return { kind: "user", user };

  const guest = await validateGuestRawToken(parseGuestRawCookie(req.headers.get("cookie")));
  if (guest) return { kind: "guest", guest };
  return null;
}

export function guestUsageFromRow(row: GuestSessionRow): GuestUsage {
  const limit = row.free_questions_limit ?? GUEST_FREE_QUESTIONS_LIMIT;
  const used = row.free_questions_used ?? 0;
  return {
    remaining: Math.max(0, limit - used),
    limit,
    sessionId: row.id,
  };
}

export async function createGuestSessionWithCookie(): Promise<{ usage: GuestUsage; setCookie: string }> {
  const secret = randomSecret();
  const token_hash = hashToken(secret);
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("guest_sessions")
    .insert({
      token_hash,
      free_questions_used: 0,
      free_questions_limit: GUEST_FREE_QUESTIONS_LIMIT,
    })
    .select("id, free_questions_used, free_questions_limit")
    .single();

  if (error || !data) throw new Error(error?.message ?? "guest insert failed");

  const raw = `${data.id}.${secret}`;
  const usage = guestUsageFromRow({
    id: data.id,
    token_hash,
    free_questions_used: data.free_questions_used,
    free_questions_limit: data.free_questions_limit,
  });

  const cookieVal = encodeURIComponent(raw);
  const setCookie = `${GUEST_SESSION_COOKIE}=${cookieVal}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${GUEST_SESSION_MAX_AGE_SEC}`;

  return { usage, setCookie };
}

export async function tryConsumeGuestQuestion(guestId: string): Promise<boolean> {
  const admin = createAdminClient();
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const { data: row, error } = await admin
      .from("guest_sessions")
      .select("id, free_questions_used, free_questions_limit")
      .eq("id", guestId)
      .maybeSingle();

    if (error || !row) return false;
    if (row.free_questions_used >= row.free_questions_limit) return false;

    const { data: updated, error: upErr } = await admin
      .from("guest_sessions")
      .update({ free_questions_used: row.free_questions_used + 1 })
      .eq("id", guestId)
      .eq("free_questions_used", row.free_questions_used)
      .select("id")
      .maybeSingle();

    if (upErr) return false;
    if (updated) return true;
  }
  return false;
}

export async function compensateGuestQuestion(guestId: string): Promise<void> {
  const admin = createAdminClient();
  const { data: row } = await admin
    .from("guest_sessions")
    .select("free_questions_used")
    .eq("id", guestId)
    .maybeSingle();
  if (!row || row.free_questions_used <= 0) return;
  await admin
    .from("guest_sessions")
    .update({ free_questions_used: row.free_questions_used - 1 })
    .eq("id", guestId);
}
