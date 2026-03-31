export type StreamLine =
  | { type: "user_message"; message: Record<string, unknown> }
  | { type: "delta"; text: string }
  | { type: "done"; assistantMessage: Record<string, unknown> }
  | { type: "error"; message: string; code?: string };

export async function postChatMessageStream(args: {
  chatId: string;
  body: { content: string; clientMessageId?: string; attachmentIds?: string[] };
  accessToken?: string | null;
  signal?: AbortSignal;
  onLine: (line: StreamLine) => void;
  /** Сразу после HTTP 200 — запрос принят, тело стрима ещё не читали */
  onHttpOk?: () => void;
  /** Первый кусок байт из ответа — соединение «дышит», сервер что-то шлёт */
  onFirstChunk?: () => void;
}): Promise<void> {
  const res = await fetch(`/api/chats/${args.chatId}/messages`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(args.accessToken ? { Authorization: `Bearer ${args.accessToken}` } : {}),
    },
    credentials: "include",
    body: JSON.stringify(args.body),
    signal: args.signal,
  });

  if (!res.ok) {
    let msg = `${res.statusText || "Request failed"} (HTTP ${res.status})`;
    try {
      const j = (await res.json()) as { error?: { message?: string } };
      if (j.error?.message) msg = j.error.message;
    } catch {
      /* keep msg */
    }
    throw new Error(msg);
  }

  args.onHttpOk?.();

  const reader = res.body?.getReader();
  if (!reader) throw new Error("No response body");

  const dec = new TextDecoder();
  let buf = "";
  let sawFirstChunk = false;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!sawFirstChunk && value && value.byteLength > 0) {
      sawFirstChunk = true;
      args.onFirstChunk?.();
    }
    buf += dec.decode(value, { stream: true });
    const lines = buf.split("\n");
    buf = lines.pop() ?? "";
    for (const line of lines) {
      const t = line.trim();
      if (!t) continue;
      args.onLine(JSON.parse(t) as StreamLine);
    }
  }
}

export function isAbortError(e: unknown): boolean {
  return e instanceof DOMException && e.name === "AbortError";
}
