import { NextResponse } from "next/server";

import { jsonError } from "@/lib/api/errors";
import { resolveCaller } from "@/lib/api/request-context";
import { createAdminClient } from "@/lib/supabase/admin";
import { assertChatOwned, deletePendingAttachmentById } from "@/server/chat-repo";

export async function DELETE(req: Request, ctx: { params: Promise<{ chatId: string; attachmentId: string }> }) {
  const { chatId, attachmentId } = await ctx.params;
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
    await deletePendingAttachmentById(admin, chatId, attachmentId);
    return new NextResponse(null, { status: 204 });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "";
    if (msg === "attachment_not_found") return jsonError(404, "Attachment not found", "not_found");
    if (msg === "attachment_forbidden") return jsonError(403, "Forbidden", "forbidden");
    if (msg === "attachment_already_sent") {
      return jsonError(409, "Attachment already bound to a message", "already_bound");
    }
    console.error("[DELETE attachment]", e);
    return jsonError(500, "Failed to delete attachment", "delete_failed");
  }
}
