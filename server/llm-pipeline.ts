import { createOpenAI, openai as openaiDefault } from "@ai-sdk/openai";
import type { LanguageModel } from "ai";
import type { ModelMessage } from "ai";
import { streamText } from "ai";

import { getEnv } from "@/lib/env";

import type { SupabaseClient } from "@supabase/supabase-js";

import { formatLlmErrorForClient } from "@/server/llm-error";
import { wrapNvidiaChatCompletionsFetch } from "@/server/nvidia-fetch";
import type { AttachmentRow, MessageRow } from "@/server/chat-repo";
import { loadAttachmentsForMessage, sliceHistory } from "@/server/chat-repo";

/** Урезает историю по числу сообщений и суммарным символам — иначе длинный чат + «напиши много» упирается в контекст и API падает / обрезает. */
function sliceHistoryForModel(rows: MessageRow[], maxMessages: number, maxTotalChars: number): MessageRow[] {
  const byCount = sliceHistory(rows, maxMessages);
  let sum = 0;
  const acc: MessageRow[] = [];
  for (let i = byCount.length - 1; i >= 0; i--) {
    const m = byCount[i];
    const add = m.content.length;
    if (acc.length > 0 && sum + add > maxTotalChars) break;
    sum += add;
    acc.push(m);
  }
  acc.reverse();
  if (acc.length) return acc;
  return byCount.length ? [byCount[byCount.length - 1]!] : [];
}

const DEFAULT_SYSTEM = "You are a helpful, concise assistant.";

async function downloadAsDataUrl(admin: SupabaseClient, path: string, mime: string): Promise<string> {
  const { data, error } = await admin.storage.from("chat-uploads").download(path);
  if (error || !data) throw error ?? new Error("download failed");
  const buf = Buffer.from(await data.arrayBuffer());
  const b64 = buf.toString("base64");
  return `data:${mime};base64,${b64}`;
}

async function userCoreMessageFromHistory(
  admin: SupabaseClient,
  msg: MessageRow,
): Promise<ModelMessage> {
  if (msg.role !== "user") {
    return { role: "assistant", content: msg.content };
  }
  const atts = await loadAttachmentsForMessage(admin, msg.id);
  const images = atts.filter((a) => a.kind === "image");
  if (!images.length) {
    return { role: "user", content: msg.content };
  }
  const parts: Array<{ type: "text"; text: string } | { type: "image"; image: string }> = [];
  if (msg.content.trim()) {
    parts.push({ type: "text", text: msg.content });
  }
  for (const img of images) {
    const url = await downloadAsDataUrl(admin, img.storage_path, img.mime_type);
    parts.push({ type: "image", image: url });
  }
  return { role: "user", content: parts };
}

export async function buildCoreMessages(args: {
  admin: SupabaseClient;
  documentBlock: string;
  priorMessages: MessageRow[];
  pendingUserMessage: MessageRow;
  pendingAttachments: AttachmentRow[];
}): Promise<ModelMessage[]> {
  const system = [DEFAULT_SYSTEM, args.documentBlock ? `Context from uploaded documents:\n${args.documentBlock}` : ""]
    .filter(Boolean)
    .join("\n\n");

  const env = getEnv();
  const prior = sliceHistoryForModel(
    args.priorMessages,
    env.LLM_HISTORY_MESSAGE_LIMIT,
    env.LLM_HISTORY_MAX_CHARS,
  );
  const mapped: ModelMessage[] = [];
  for (const m of prior) {
    mapped.push(await userCoreMessageFromHistory(args.admin, m));
  }

  const text = args.pendingUserMessage.content.trim();
  const images = args.pendingAttachments.filter((a) => a.kind === "image");
  if (!images.length) {
    mapped.push({ role: "user", content: text });
  } else {
    const parts: Array<{ type: "text"; text: string } | { type: "image"; image: string }> = [];
    if (text) parts.push({ type: "text", text });
    for (const img of images) {
      const url = await downloadAsDataUrl(args.admin, img.storage_path, img.mime_type);
      parts.push({ type: "image", image: url });
    }
    mapped.push({ role: "user", content: parts });
  }

  return [{ role: "system", content: system }, ...mapped];
}

function getChatModel(): LanguageModel {
  const env = getEnv();
  if (env.NVIDIA_API_KEY?.trim()) {
    const thinking = env.NVIDIA_CHAT_THINKING !== "false" && env.NVIDIA_CHAT_THINKING !== "0";
    const nvidia = createOpenAI({
      baseURL: env.NVIDIA_BASE_URL.replace(/\/$/, ""),
      apiKey: env.NVIDIA_API_KEY,
      ...(thinking ? { fetch: wrapNvidiaChatCompletionsFetch(true) } : {}),
    });
    return nvidia.chat(env.NVIDIA_MODEL);
  }
  if (env.DEEPSEEK_API_KEY?.trim()) {
    const deepseek = createOpenAI({
      baseURL: env.DEEPSEEK_BASE_URL.replace(/\/$/, ""),
      apiKey: env.DEEPSEEK_API_KEY,
    });
    /** AI SDK v3: `provider(id)` = Responses API (`/responses`); DeepSeek needs `.chat()` → `/v1/chat/completions`. */
    return deepseek.chat(env.DEEPSEEK_MODEL);
  }
  return openaiDefault.chat(env.OPENAI_MODEL);
}

function streamTextOptionsForProvider() {
  const env = getEnv();
  if (env.NVIDIA_API_KEY?.trim()) {
    return {
      maxOutputTokens: env.NVIDIA_MAX_OUTPUT_TOKENS,
      temperature: env.NVIDIA_TEMPERATURE,
      topP: env.NVIDIA_TOP_P,
    } as const;
  }
  return {} as const;
}

function splitSystemMessages(coreMessages: ModelMessage[]): { system?: string; messages: ModelMessage[] } {
  if (!coreMessages.length || coreMessages[0].role !== "system") {
    return { messages: coreMessages };
  }
  const first = coreMessages[0];
  const system = typeof first.content === "string" ? first.content : "";
  return { system: system || undefined, messages: coreMessages.slice(1) };
}

export async function streamAssistantText(args: {
  coreMessages: ModelMessage[];
  onDelta: (t: string) => void;
  abortSignal?: AbortSignal;
}): Promise<string> {
  const { system, messages } = splitSystemMessages(args.coreMessages);

  const result = streamText({
    model: getChatModel(),
    ...streamTextOptionsForProvider(),
    ...(system !== undefined ? { system } : {}),
    messages,
    abortSignal: args.abortSignal,
    maxRetries: 1,
  });

  let full = "";
  try {
    for await (const part of result.fullStream) {
      if (part.type === "text-delta") {
        full += part.text;
        args.onDelta(part.text);
      } else if (part.type === "reasoning-delta") {
        full += part.text;
        args.onDelta(part.text);
      } else if (part.type === "error") {
        const err = part.error;
        throw err instanceof Error ? err : new Error(formatLlmErrorForClient(err));
      }
    }
  } catch (e) {
    console.error("[streamAssistantText] fullStream", e);
    throw e instanceof Error ? e : new Error(formatLlmErrorForClient(e));
  }

  let finalized = "";
  try {
    finalized = await result.text;
  } catch (e) {
    console.error("[streamAssistantText] result.text", e);
    throw new Error(formatLlmErrorForClient(e) || "LLM request failed", { cause: e });
  }

  if (finalized.length > full.length) {
    const rest = finalized.slice(full.length);
    if (rest) {
      args.onDelta(rest);
      full = finalized;
    }
  } else if (!full.trim() && finalized.trim()) {
    args.onDelta(finalized);
    full = finalized;
  }

  if (!full.trim()) {
    const reason = await result.finishReason;
    const warnings = await result.warnings;
    console.warn("[streamAssistantText] empty text", { finishReason: reason, warnings });
    throw new Error(
      "The model returned empty text. Check your API key (NVIDIA / DeepSeek / OpenAI), model name, and limits; for DeepSeek use DEEPSEEK_BASE_URL=https://api.deepseek.com/v1 and a chat-compatible provider.",
    );
  }

  return full;
}
