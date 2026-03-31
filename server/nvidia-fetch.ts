/**
 * NVIDIA NIM chat/completions принимает расширения вроде `chat_template_kwargs: { thinking: true }`.
 * @ai-sdk/openai не пробрасывает это поле — добавляем через обёртку fetch.
 */
function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

export function wrapNvidiaChatCompletionsFetch(thinking: boolean): typeof fetch {
  const base = globalThis.fetch.bind(globalThis) as typeof fetch;
  return async (input: RequestInfo | URL, init?: RequestInit) => {
    if (!thinking || !init?.body || typeof init.body !== "string") {
      return base(input, init);
    }
    try {
      const url = requestUrl(input);
      if (!url.includes("chat/completions")) {
        return base(input, init);
      }
      const body = JSON.parse(init.body) as Record<string, unknown>;
      body.chat_template_kwargs = { thinking: true };
      return base(input, { ...init, body: JSON.stringify(body) });
    } catch {
      return base(input, init);
    }
  };
}
