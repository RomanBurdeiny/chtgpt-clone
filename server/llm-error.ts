import { APICallError } from "@ai-sdk/provider";
import { NoOutputGeneratedError } from "ai";

const MAX = 900;

const NO_OUTPUT_HINT =
  "Stream had no text step (often DeepSeek + AI SDK). Set DEEPSEEK_BASE_URL=https://api.deepseek.com/v1, DEEPSEEK_MODEL=deepseek-chat, check your key and balance. deepseek-reasoner emits “thoughts” separately — switch to deepseek-chat if replies are empty.";

export function formatLlmErrorForClient(e: unknown): string {
  if (NoOutputGeneratedError.isInstance(e)) {
    return `${e.message} ${NO_OUTPUT_HINT}`.slice(0, MAX);
  }
  if (APICallError.isInstance(e)) {
    let bodyMsg = "";
    if (e.responseBody) {
      try {
        const j = JSON.parse(e.responseBody) as {
          error?: { message?: string; type?: string };
          message?: string;
        };
        bodyMsg = j.error?.message ?? j.message ?? "";
      } catch {
        /* ignore */
      }
    }
    if (e.statusCode === 402 || /insufficient balance/i.test(e.message) || /insufficient balance/i.test(bodyMsg)) {
      return (
        "Insufficient DeepSeek balance (top up at platform.deepseek.com). " +
        "Or set OPENAI_API_KEY and temporarily unset DEEPSEEK_API_KEY."
      ).slice(0, MAX);
    }
    const bits: string[] = [];
    if (e.message) bits.push(e.message);
    if (e.statusCode != null) bits.push(`HTTP ${e.statusCode}`);
    if (bodyMsg) {
      bits.push(bodyMsg);
    } else if (e.responseBody) {
      try {
        const j = JSON.parse(e.responseBody) as {
          error?: { message?: string; type?: string };
          message?: string;
        };
        const m = j.error?.message ?? j.message;
        if (m) bits.push(m);
        if (j.error?.type) bits.push(`(${j.error.type})`);
      } catch {
        const t = e.responseBody.trim();
        if (t.length > 0 && t.length < 500) bits.push(t);
      }
    }
    const s = [...new Set(bits)].join(" — ");
    if (s) return s.slice(0, MAX);
  }
  if (e instanceof Error && e.message) return e.message.slice(0, MAX);
  return String(e).slice(0, MAX);
}
