import { z } from "zod";

import { jsonError } from "@/lib/api/errors";
import {
  compensateGuestQuestion,
  resolveCaller,
  tryConsumeGuestQuestion,
} from "@/lib/api/request-context";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  assertChatOwned,
  bindAttachmentsToMessage,
  buildDocumentContextBlock,
  claimPendingAttachments,
  findMessageByClientId,
  insertAssistantMessage,
  insertUserMessage,
  loadMessages,
  touchChatUpdatedAt,
  type MessageRow,
} from "@/server/chat-repo";
import { formatLlmErrorForClient } from "@/server/llm-error";
import { buildCoreMessages, streamAssistantText } from "@/server/llm-pipeline";

/**
 * Serverless timeout for streaming LLM replies (seconds).
 * Default **300** matches Vercel Hobby max. On Pro+, set `MESSAGES_MAX_DURATION` in the dashboard (e.g. `600`) if your plan allows it.
 */
const n = parseInt(process.env.MESSAGES_MAX_DURATION ?? "300", 10);
export const maxDuration = Number.isFinite(n) ? Math.max(1, Math.min(n, 900)) : 300;

const bodySchema = z.object({
  content: z.string().min(1).max(32000),
  clientMessageId: z.string().uuid().optional(),
  attachmentIds: z.array(z.string().uuid()).max(8).optional(),
});

type StreamLine =
  | { type: "user_message"; message: Record<string, unknown> }
  | { type: "delta"; text: string }
  | { type: "done"; assistantMessage: Record<string, unknown> }
  | { type: "error"; message: string; code?: string };

function publicMessage(m: MessageRow, attachments?: Array<{ id: string; mimeType: string; kind: string; url?: string }>) {
  return {
    id: m.id,
    role: m.role,
    content: m.content,
    sequence: m.sequence,
    createdAt: m.created_at,
    ...(attachments?.length ? { attachments } : {}),
  };
}

export async function POST(req: Request, ctx: { params: Promise<{ chatId: string }> }) {
  const { chatId } = await ctx.params;
  const caller = await resolveCaller(req);
  if (!caller) return jsonError(401, "Unauthorized", "unauthorized");

  let parsed: z.infer<typeof bodySchema>;
  try {
    parsed = bodySchema.parse(await req.json());
  } catch {
    return jsonError(400, "Invalid body", "invalid_body");
  }

  const admin = createAdminClient();
  let chat;
  try {
    chat = await assertChatOwned(admin, caller, chatId);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "";
    if (msg === "not_found") return jsonError(404, "Chat not found", "not_found");
    return jsonError(403, "Forbidden", "forbidden");
  }

  if (parsed.clientMessageId) {
    const dup = await findMessageByClientId(admin, chatId, parsed.clientMessageId);
    if (dup) {
      return jsonError(409, "Duplicate client message id", "duplicate");
    }
  }

  let pendingAttachments;
  try {
    pendingAttachments = await claimPendingAttachments(admin, chatId, parsed.attachmentIds);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "";
    if (msg === "attachment_mismatch") {
      return jsonError(400, "Invalid or stale attachments", "attachments_invalid");
    }
    return jsonError(500, "Attachment validation failed", "attachments_failed");
  }

  let quotaConsumed = false;
  const guestId = caller.kind === "guest" ? caller.guest.id : null;
  if (guestId) {
    const ok = await tryConsumeGuestQuestion(guestId);
    if (!ok) {
      return jsonError(403, "Sign in to continue — free questions used.", "guest_quota");
    }
    quotaConsumed = true;
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const write = (line: StreamLine) => {
        controller.enqueue(encoder.encode(`${JSON.stringify(line)}\n`));
      };

      try {
        const prior = await loadMessages(admin, chatId, 500);
        const lastSeq = prior.length ? Math.max(...prior.map((m) => m.sequence)) : -1;
        const nextSeq = lastSeq + 1;

        const userMsg = await insertUserMessage(admin, {
          chatId,
          content: parsed.content.trim(),
          sequence: nextSeq,
          clientMessageId: parsed.clientMessageId,
        });

        if (parsed.attachmentIds?.length) {
          await bindAttachmentsToMessage(admin, parsed.attachmentIds, userMsg.id);
        }

        const adminForAtt = createAdminClient();
        const signUrl = async (path: string) => {
          const { data } = await adminForAtt.storage.from("chat-uploads").createSignedUrl(path, 3600);
          return data?.signedUrl ?? undefined;
        };

        const attachmentPublic = [];
        for (const a of pendingAttachments) {
          const url = await signUrl(a.storage_path);
          attachmentPublic.push({
            id: a.id,
            mimeType: a.mime_type,
            kind: a.kind,
            url,
          });
        }

        write({ type: "user_message", message: publicMessage(userMsg, attachmentPublic) });

        const documentBlock = await buildDocumentContextBlock(admin, chatId);
        const coreMessages = await buildCoreMessages({
          admin,
          documentBlock,
          priorMessages: prior,
          pendingUserMessage: userMsg,
          pendingAttachments,
        });

        let assistantText = "";
        try {
          assistantText = await streamAssistantText({
            coreMessages,
            onDelta: (t) => write({ type: "delta", text: t }),
            abortSignal: req.signal,
          });
        } catch (llmErr) {
          if (quotaConsumed && guestId) await compensateGuestQuestion(guestId);
          const detail = formatLlmErrorForClient(llmErr);
          console.error("[messages] LLM error", llmErr);
          write({
            type: "error",
            message: detail || "Model request failed",
            code: "llm_error",
          });
          return;
        }

        const assistantMsg = await insertAssistantMessage(admin, {
          chatId,
          content: assistantText,
          sequence: nextSeq + 1,
        });

        if (chat.title === "New chat" && parsed.content.trim()) {
          const t = parsed.content.trim().slice(0, 56);
          await admin.from("chats").update({ title: t || chat.title }).eq("id", chatId);
        }

        await touchChatUpdatedAt(admin, chatId);

        write({ type: "done", assistantMessage: publicMessage(assistantMsg) });
      } catch {
        if (quotaConsumed && guestId) await compensateGuestQuestion(guestId);
        write({ type: "error", message: "Could not complete message", code: "failed" });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-cache",
      "X-Accel-Buffering": "no",
    },
  });
}
