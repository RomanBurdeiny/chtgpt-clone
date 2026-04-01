import { randomUUID } from "crypto";
import { NextResponse } from "next/server";

import { jsonError } from "@/lib/api/errors";
import { resolveCaller } from "@/lib/api/request-context";
import { MAX_UPLOAD_BYTES } from "@/lib/constants";
import { createAdminClient } from "@/lib/supabase/admin";
import { assertChatOwned } from "@/server/chat-repo";
import { extractDocumentText } from "@/server/extract-document";

const ALLOWED_IMAGE = /^image\//;
const ALLOWED_DOC = new Set(["application/pdf", "text/plain", "text/markdown"]);

export async function POST(req: Request, ctx: { params: Promise<{ chatId: string }> }) {
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

  const ct = req.headers.get("content-type") ?? "";
  if (!ct.includes("multipart/form-data")) {
    return jsonError(400, "Expected multipart form data", "invalid_content_type");
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return jsonError(400, "Invalid form data", "invalid_form");
  }

  const file = form.get("file");
  if (!(file instanceof File)) {
    return jsonError(400, "Missing file field", "missing_file");
  }

  if (file.size > MAX_UPLOAD_BYTES) {
    return jsonError(413, "File too large", "too_large");
  }

  const mime = file.type || "application/octet-stream";
  const isImage = ALLOWED_IMAGE.test(mime);
  const isDoc = ALLOWED_DOC.has(mime);
  if (!isImage && !isDoc) {
    return jsonError(400, "Unsupported file type", "unsupported_type");
  }

  const kind = isImage ? "image" : "document";
  const buf = Buffer.from(await file.arrayBuffer());
  const safeName = file.name.replace(/[^\w.\-]+/g, "_").slice(0, 80);
  const objectPath = `${chatId}/${randomUUID()}-${safeName}`;

  const up = await admin.storage.from("chat-uploads").upload(objectPath, buf, {
    contentType: mime,
    upsert: false,
  });
  if (up.error) {
    console.error("[attachments] storage.upload failed", chatId, up.error.message, up.error);
    return NextResponse.json(
      {
        error: {
          message: "Upload failed",
          code: "upload_failed",
          details: up.error.message,
        },
      },
      { status: 500 },
    );
  }

  let extracted_text: string | null = null;
  if (kind === "document") {
    extracted_text = (await extractDocumentText(buf, mime)) || null;
    if (!extracted_text?.trim()) {
      extracted_text = "(No extractable text)";
    }
  }

  const { data: row, error } = await admin
    .from("chat_attachments")
    .insert({
      chat_id: chatId,
      message_id: null,
      storage_path: objectPath,
      mime_type: mime,
      kind,
      extracted_text,
    })
    .select("id, storage_path, mime_type, kind")
    .single();

  if (error || !row) {
    return jsonError(500, "Failed to save attachment", "db_failed");
  }

  const { data: signed } = await admin.storage.from("chat-uploads").createSignedUrl(objectPath, 3600);

  return NextResponse.json(
    {
      id: row.id as string,
      mimeType: row.mime_type as string,
      kind: row.kind as string,
      url: signed?.signedUrl,
    },
    { status: 201 },
  );
}
