import { NextResponse } from "next/server";
import { z } from "zod";

import { jsonError } from "@/lib/api/errors";
import { parseClampedIntParam } from "@/lib/api/query-parse";
import { resolveCaller } from "@/lib/api/request-context";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  assertChatOwned,
  deleteChat,
  loadAttachmentsForChat,
  loadMessages,
  updateChatTitle,
} from "@/server/chat-repo";

const patchSchema = z.object({
  title: z.string().trim().min(1).max(120),
});

async function signUrl(admin: ReturnType<typeof createAdminClient>, path: string) {
  const { data, error } = await admin.storage.from("chat-uploads").createSignedUrl(path, 3600);
  if (error || !data?.signedUrl) return null;
  return data.signedUrl;
}

export async function GET(req: Request, ctx: { params: Promise<{ chatId: string }> }) {
  const { chatId } = await ctx.params;
  const caller = await resolveCaller(req);
  if (!caller) return jsonError(401, "Unauthorized", "unauthorized");

  const admin = createAdminClient();
  try {
    await assertChatOwned(admin, caller, chatId);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "";
    if (msg === "not_found") return jsonError(404, "Chat not found", "not_found");
    return jsonError(403, "Forbidden", "forbidden");
  }

  const messagesLimit = parseClampedIntParam(
    new URL(req.url).searchParams,
    "messagesLimit",
    200,
    1,
    500,
  );

  try {
    const [messages, attachments] = await Promise.all([
      loadMessages(admin, chatId, messagesLimit),
      loadAttachmentsForChat(admin, chatId),
    ]);

    const attachByMsg = new Map<string, typeof attachments>();
    for (const a of attachments) {
      if (!a.message_id) continue;
      const list = attachByMsg.get(a.message_id) ?? [];
      list.push(a);
      attachByMsg.set(a.message_id, list);
    }

    const items = [];
    for (const m of messages) {
      const atts = attachByMsg.get(m.id) ?? [];
      const resolved = [];
      for (const a of atts) {
        const url = await signUrl(admin, a.storage_path);
        resolved.push({
          id: a.id,
          mimeType: a.mime_type,
          kind: a.kind,
          url: url ?? undefined,
        });
      }
      items.push({
        id: m.id,
        role: m.role,
        content: m.content,
        sequence: m.sequence,
        createdAt: m.created_at,
        attachments: resolved.length ? resolved : undefined,
      });
    }

    const { data: chatRow } = await admin.from("chats").select("title, updated_at").eq("id", chatId).single();

    return NextResponse.json({
      id: chatId,
      title: (chatRow as { title: string })?.title ?? "Chat",
      updatedAt: (chatRow as { updated_at: string })?.updated_at,
      messages: items,
    });
  } catch {
    return jsonError(500, "Failed to load chat", "load_failed");
  }
}

export async function PATCH(req: Request, ctx: { params: Promise<{ chatId: string }> }) {
  const { chatId } = await ctx.params;
  const caller = await resolveCaller(req);
  if (!caller) return jsonError(401, "Unauthorized", "unauthorized");

  let body: z.infer<typeof patchSchema>;
  try {
    body = patchSchema.parse(await req.json());
  } catch {
    return jsonError(400, "Invalid body", "invalid_body");
  }

  const admin = createAdminClient();
  try {
    await assertChatOwned(admin, caller, chatId);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "";
    if (msg === "not_found") return jsonError(404, "Chat not found", "not_found");
    return jsonError(403, "Forbidden", "forbidden");
  }

  try {
    await updateChatTitle(admin, chatId, body.title);
    return NextResponse.json({ ok: true });
  } catch {
    return jsonError(500, "Failed to update chat", "update_failed");
  }
}

export async function DELETE(req: Request, ctx: { params: Promise<{ chatId: string }> }) {
  const { chatId } = await ctx.params;
  const caller = await resolveCaller(req);
  if (!caller) return jsonError(401, "Unauthorized", "unauthorized");

  const admin = createAdminClient();
  try {
    await assertChatOwned(admin, caller, chatId);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "";
    if (msg === "not_found") return jsonError(404, "Chat not found", "not_found");
    return jsonError(403, "Forbidden", "forbidden");
  }

  try {
    await deleteChat(admin, chatId);
    return new NextResponse(null, { status: 204 });
  } catch {
    return jsonError(500, "Failed to delete chat", "delete_failed");
  }
}
