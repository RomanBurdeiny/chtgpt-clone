import { z } from "zod";

const schema = z
  .object({
    NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
    NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1),
    SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
    /** NVIDIA NIM / build endpoints (OpenAI-совместимый /v1); если задан — приоритет над DeepSeek/OpenAI */
    NVIDIA_API_KEY: z.string().optional(),
    NVIDIA_BASE_URL: z.string().url().optional().default("https://integrate.api.nvidia.com/v1"),
    NVIDIA_MODEL: z.string().optional().default("deepseek-ai/deepseek-v3.2"),
    /** true = chat_template_kwargs.thinking (может долго не отдавать токены в стрим). По умолчанию выкл. */
    NVIDIA_CHAT_THINKING: z.string().optional().default("false"),
    NVIDIA_MAX_OUTPUT_TOKENS: z.coerce.number().optional().default(16_384),
    NVIDIA_TEMPERATURE: z.coerce.number().optional().default(1),
    NVIDIA_TOP_P: z.coerce.number().optional().default(0.95),
    /** OpenAI — если нет NVIDIA и DeepSeek */
    OPENAI_API_KEY: z.string().optional(),
    OPENAI_MODEL: z.string().optional().default("gpt-4o-mini"),
    /** DeepSeek (OpenAI-совместимый API) */
    DEEPSEEK_API_KEY: z.string().optional(),
    DEEPSEEK_MODEL: z.string().optional().default("deepseek-chat"),
    DEEPSEEK_BASE_URL: z.string().url().optional().default("https://api.deepseek.com/v1"),
    /** Сколько последних сообщений из истории отдавать в LLM (меньше — меньше риск переполнить контекст при длинных ответах). */
    LLM_HISTORY_MESSAGE_LIMIT: z.coerce.number().int().positive().optional().default(48),
    /** Ограничение по суммарной длине текста истории (~символы), чтобы не уткнуться в окно модели. */
    LLM_HISTORY_MAX_CHARS: z.coerce.number().int().positive().optional().default(100_000),
  })
  .refine(
    (e) =>
      Boolean(e.NVIDIA_API_KEY?.trim()) ||
      Boolean(e.DEEPSEEK_API_KEY?.trim()) ||
      Boolean(e.OPENAI_API_KEY?.trim()),
    { message: "Set NVIDIA_API_KEY, DEEPSEEK_API_KEY, or OPENAI_API_KEY" },
  );

export type Env = z.infer<typeof schema>;

let cached: Env | null = null;

export function getEnv(): Env {
  if (cached) return cached;
  cached = schema.parse(process.env);
  return cached;
}
