import type { SupabaseClient } from "@supabase/supabase-js";

import type { Caller } from "@/lib/api/request-context";
import { DOCUMENT_CONTEXT_MAX_CHARS } from "@/lib/constants";

export type ChatRow = {
  id: string;
  user_id: string | null;
  guest_session_id: string | null;
  title: string;
  updated_at: string;
};

export type MessageRow = {
  id: string;
  chat_id: string;
  role: "user" | "assistant";
  content: string;
  sequence: number;
  client_message_id: string | null;
  created_at: string;
};

export type AttachmentRow = {
  id: string;
  chat_id: string;
  message_id: string | null;
  storage_path: string;
  mime_type: string;
  kind: "image" | "document";
  extracted_text: string | null;
};

export async function assertChatOwned(admin: SupabaseClient, caller: Caller, chatId: string): Promise<ChatRow> {
  const { data, error } = await admin.from("chats").select("*").eq("id", chatId).maybeSingle();
  if (error || !data) throw new Error("not_found");
  const row = data as ChatRow;
  if (caller.kind === "user") {
    if (row.user_id !== caller.user.id) throw new Error("forbidden");
  } else {
    if (row.guest_session_id !== caller.guest.id) throw new Error("forbidden");
  }
  return row;
}

export async function listChats(
  admin: SupabaseClient,
  caller: Caller,
  limit = 100,
): Promise<ChatRow[]> {
  const q = admin.from("chats").select("*").order("updated_at", { ascending: false }).limit(limit);
  if (caller.kind === "user") {
    q.eq("user_id", caller.user.id);
  } else {
    q.eq("guest_session_id", caller.guest.id);
  }
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as ChatRow[];
}

export async function createChat(admin: SupabaseClient, caller: Caller, title: string): Promise<ChatRow> {
  const insert =
    caller.kind === "user"
      ? { user_id: caller.user.id, guest_session_id: null, title }
      : { user_id: null, guest_session_id: caller.guest.id, title };

  const { data, error } = await admin.from("chats").insert(insert).select("*").single();
  if (error || !data) throw error ?? new Error("insert chat failed");
  return data as ChatRow;
}

export async function updateChatTitle(admin: SupabaseClient, chatId: string, title: string): Promise<void> {
  const { error } = await admin.from("chats").update({ title, updated_at: new Date().toISOString() }).eq("id", chatId);
  if (error) throw error;
}

export async function touchChatUpdatedAt(admin: SupabaseClient, chatId: string): Promise<void> {
  await admin.from("chats").update({ updated_at: new Date().toISOString() }).eq("id", chatId);
}

export async function deleteChat(admin: SupabaseClient, chatId: string): Promise<void> {
  const { error } = await admin.from("chats").delete().eq("id", chatId);
  if (error) throw error;
}

export async function loadMessages(admin: SupabaseClient, chatId: string, limit: number): Promise<MessageRow[]> {
  const { data, error } = await admin
    .from("messages")
    .select("*")
    .eq("chat_id", chatId)
    .order("sequence", { ascending: true })
    .limit(limit);
  if (error) throw error;
  return (data ?? []) as MessageRow[];
}

export async function loadAttachmentsForChat(admin: SupabaseClient, chatId: string): Promise<AttachmentRow[]> {
  const { data, error } = await admin.from("chat_attachments").select("*").eq("chat_id", chatId);
  if (error) throw error;
  return (data ?? []) as AttachmentRow[];
}

export async function loadAttachmentsForMessage(
  admin: SupabaseClient,
  messageId: string,
): Promise<AttachmentRow[]> {
  const { data, error } = await admin.from("chat_attachments").select("*").eq("message_id", messageId);
  if (error) throw error;
  return (data ?? []) as AttachmentRow[];
}

export async function bindAttachmentsToMessage(
  admin: SupabaseClient,
  attachmentIds: string[],
  messageId: string,
): Promise<void> {
  if (!attachmentIds.length) return;
  const { error } = await admin
    .from("chat_attachments")
    .update({ message_id: messageId })
    .in("id", attachmentIds);
  if (error) throw error;
}

export async function claimPendingAttachments(
  admin: SupabaseClient,
  chatId: string,
  attachmentIds: string[] | undefined,
): Promise<AttachmentRow[]> {
  if (!attachmentIds?.length) return [];
  const { data, error } = await admin
    .from("chat_attachments")
    .select("*")
    .eq("chat_id", chatId)
    .in("id", attachmentIds)
    .is("message_id", null);
  if (error) throw error;
  const rows = (data ?? []) as AttachmentRow[];
  if (rows.length !== attachmentIds.length) throw new Error("attachment_mismatch");
  return rows;
}

export async function insertUserMessage(
  admin: SupabaseClient,
  args: {
    chatId: string;
    content: string;
    sequence: number;
    clientMessageId?: string;
  },
): Promise<MessageRow> {
  const { data, error } = await admin
    .from("messages")
    .insert({
      chat_id: args.chatId,
      role: "user",
      content: args.content,
      sequence: args.sequence,
      ...(args.clientMessageId ? { client_message_id: args.clientMessageId } : {}),
    })
    .select("*")
    .single();
  if (error || !data) throw error ?? new Error("insert user message failed");
  return data as MessageRow;
}

export async function insertAssistantMessage(
  admin: SupabaseClient,
  args: { chatId: string; content: string; sequence: number },
): Promise<MessageRow> {
  const { data, error } = await admin
    .from("messages")
    .insert({
      chat_id: args.chatId,
      role: "assistant",
      content: args.content,
      sequence: args.sequence,
    })
    .select("*")
    .single();
  if (error || !data) throw error ?? new Error("insert assistant message failed");
  return data as MessageRow;
}

export async function findMessageByClientId(
  admin: SupabaseClient,
  chatId: string,
  clientMessageId: string,
): Promise<MessageRow | null> {
  const { data } = await admin
    .from("messages")
    .select("*")
    .eq("chat_id", chatId)
    .eq("client_message_id", clientMessageId)
    .maybeSingle();
  return (data as MessageRow | null) ?? null;
}

export async function buildDocumentContextBlock(admin: SupabaseClient, chatId: string): Promise<string> {
  const { data, error } = await admin
    .from("chat_attachments")
    .select("extracted_text")
    .eq("chat_id", chatId)
    .eq("kind", "document")
    .not("extracted_text", "is", null);
  if (error) return "";
  const parts = (data ?? [])
    .map((r) => (r as { extracted_text: string }).extracted_text?.trim())
    .filter(Boolean) as string[];
  if (!parts.length) return "";
  const merged = parts.join("\n\n---\n\n");
  return merged.length > DOCUMENT_CONTEXT_MAX_CHARS
    ? merged.slice(0, DOCUMENT_CONTEXT_MAX_CHARS)
    : merged;
}

export function sliceHistory<T>(rows: T[], limit: number): T[] {
  if (rows.length <= limit) return rows;
  return rows.slice(rows.length - limit);
}
