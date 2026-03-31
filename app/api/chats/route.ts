import { NextResponse } from "next/server";
import { z } from "zod";

import { jsonError } from "@/lib/api/errors";
import { parseClampedIntParam } from "@/lib/api/query-parse";
import { resolveCaller } from "@/lib/api/request-context";
import { createAdminClient } from "@/lib/supabase/admin";
import { createChat, listChats } from "@/server/chat-repo";

const postSchema = z.object({
  title: z.string().trim().min(1).max(120).optional(),
});

export async function GET(req: Request) {
  const caller = await resolveCaller(req);
  if (!caller) return jsonError(401, "Unauthorized", "unauthorized");

  const listLimit = parseClampedIntParam(new URL(req.url).searchParams, "limit", 100, 1, 100);

  const admin = createAdminClient();
  try {
    const rows = await listChats(admin, caller, listLimit);
    return NextResponse.json({
      items: rows.map((c) => ({
        id: c.id,
        title: c.title,
        updatedAt: c.updated_at,
      })),
    });
  } catch {
    return jsonError(500, "Failed to list chats", "list_failed");
  }
}

export async function POST(req: Request) {
  const caller = await resolveCaller(req);
  if (!caller) return jsonError(401, "Unauthorized", "unauthorized");

  let body: z.infer<typeof postSchema>;
  try {
    body = postSchema.parse(await req.json());
  } catch {
    return jsonError(400, "Invalid body", "invalid_body");
  }

  const title = body.title ?? "New chat";
  const admin = createAdminClient();
  try {
    const chat = await createChat(admin, caller, title);
    return NextResponse.json(
      {
        id: chat.id,
        title: chat.title,
        updatedAt: chat.updated_at,
      },
      { status: 201 },
    );
  } catch {
    return jsonError(500, "Failed to create chat", "create_failed");
  }
}
