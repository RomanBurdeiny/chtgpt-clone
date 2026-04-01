# Chat demo (ChatGPT-style)

Next.js app with a **REST API under `/api/*`**, **Postgres via Supabase** (service role only in route handlers), **Supabase Auth**, **TanStack Query**, **shadcn/ui + Tailwind**, streaming assistant replies (**NDJSON**), guest sessions (**3 free assistant turns**), image and document uploads for **context**, **BroadcastChannel** for multi-tab sync, and **Supabase Realtime** for authenticated users (`chats` table).

## Quick start

1. Create a [Supabase](https://supabase.com) project.
2. In **SQL Editor**, run the full script from `supabase/migrations/001_initial.sql` (ignore “already in publication” if that line errors).
3. Copy `.env.example` → `.env.local` and fill in Supabase keys + **at least one** of `NVIDIA_API_KEY`, `DEEPSEEK_API_KEY`, `OPENAI_API_KEY`.
4. `npm install` → `npm run dev` → open [http://localhost:3000](http://localhost:3000).

## Prerequisites

- **Node 20+**
- **Supabase** project (Postgres + Auth + Storage bucket `chat-uploads` from the migration)
- **LLM API** — [NVIDIA](https://build.nvidia.com) (`NVIDIA_API_KEY`, base `https://integrate.api.nvidia.com/v1`), and/or [DeepSeek](https://platform.deepseek.com/api_keys), and/or [OpenAI](https://platform.openai.com). **Order:** NVIDIA → DeepSeek → OpenAI. Image understanding needs a **vision-capable** model; many chat models are text-only.

## 1. Database and storage

Without the SQL migration you may see errors like `Could not find the table 'public.guest_sessions'` — env keys alone are not enough.

1. Supabase **SQL Editor** → **New query** → paste all of `supabase/migrations/001_initial.sql` → **Run**.
2. If `alter publication supabase_realtime add table public.chats` says the table is already in the publication, skip that step.
3. **Authentication → Providers → Email** — enable **Email**.

### Email confirmation (demo-friendly)

By default Supabase may require **email confirmation** after sign-up. You do **not** need Resend for class demos, but users cannot sign in until they click the link.

**To allow immediate sign-in / sign-up (no email):**

1. [Supabase Dashboard](https://supabase.com/dashboard) → your project → **Authentication** → **Providers** → **Email**.
2. Turn off **Confirm email** / **Enable email confirmations** (wording may vary).
3. Save. New users get a session right away. Existing users with `email_confirmed_at = null` can be confirmed under **Authentication → Users**, or removed and re-registered.

For **production**, turn confirmation back on and configure **SMTP** or **Resend** under **Project Settings → Auth**.

### Troubleshooting auth

- **“Anonymous sign-ins are disabled”** (or similar) when using login/register: usually **`NEXT_PUBLIC_SUPABASE_ANON_KEY` is not the anon key** (e.g. service role was pasted) — fix `.env.local`. Or the **Email** provider is disabled — enable it under **Authentication → Providers → Email**.
- **Sign up** must not be nested inside the **Sign in** form (wrong request).

All app data goes through the **API** with the **service role**. **RLS** on `chats` is narrow (`SELECT` for own rows) so **Realtime** works for authenticated clients; the service role bypasses RLS for normal API access.

## 2. Environment

Copy `.env.example` to `.env.local`:

| Variable | Where |
|----------|--------|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase **Settings → API** |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase **anon** public key |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase **service_role** key (**server only**) |
| `NVIDIA_API_KEY` | Optional; used first if set |
| `NVIDIA_BASE_URL` | Optional, default `https://integrate.api.nvidia.com/v1` |
| `NVIDIA_MODEL` | Optional |
| `NVIDIA_CHAT_THINKING` | Optional, default `false` |
| `DEEPSEEK_API_KEY` | When NVIDIA unset |
| `DEEPSEEK_MODEL` / `DEEPSEEK_BASE_URL` | Optional |
| `OPENAI_API_KEY` | When neither NVIDIA nor DeepSeek |
| `OPENAI_MODEL` | Optional |

Never commit `.env.local` or expose `SUPABASE_SERVICE_ROLE_KEY` or LLM keys to the browser bundle.

## 3. Run locally

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000): **Open chat** (guest), or **Sign in** (`/login`) / **Register** (`/register`) after users exist in Supabase **Authentication → Users**.

## API overview

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/api/guest/session` | Guest quota (`remaining`, `limit`) |
| `POST` | `/api/guest/session` | Create guest session (`HttpOnly` cookie) |
| `GET` | `/api/chats` | List chats (optional `?limit=`, **1–100**, default **100**) |
| `POST` | `/api/chats` | Create chat |
| `GET` | `/api/chats/:chatId` | Chat + messages + signed attachment URLs (optional `?messagesLimit=`, **1–500**, default **200** — oldest messages may be omitted if the chat is long) |
| `PATCH` | `/api/chats/:chatId` | Rename chat |
| `DELETE` | `/api/chats/:chatId` | Delete chat |
| `POST` | `/api/chats/:chatId/messages` | Send message; response **`application/x-ndjson`** stream |
| `POST` | `/api/chats/:chatId/attachments` | Multipart upload (`file` field) |
| `DELETE` | `/api/chats/:chatId/attachments/:attachmentId` | Remove a pending attachment (not yet sent with a message); **204** empty body |

Authenticated calls: `Authorization: Bearer <supabase_access_token>` (from the Supabase session after sign-in).

## Deploy on Vercel

### 1. Repo

Push the project to GitHub/GitLab/Bitbucket. If this folder lives inside a monorepo, note the **root directory** (e.g. `chatgpt-clone`) for step 2.

### 2. New project

1. [Vercel Dashboard](https://vercel.com/new) → **Add New** → **Project** → import the repo.
2. **Framework Preset:** Next.js (auto).
3. **Root Directory:** set only if the app is not the repo root.
4. **Build Command:** `npm run build` (default).
5. **Install Command:** `npm install` (default).

### 3. Environment variables

In **Settings → Environment Variables**, add the same keys as in `.env.example` (at minimum):

| Name | Environments | Sensitive |
|------|----------------|-----------|
| `NEXT_PUBLIC_SUPABASE_URL` | Production, Preview, Development | No |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | All | No (public anon only) |
| `SUPABASE_SERVICE_ROLE_KEY` | All | **Yes** — server only |
| One of `NVIDIA_API_KEY`, `DEEPSEEK_API_KEY`, `OPENAI_API_KEY` | All | **Yes** |
| Optional: `NVIDIA_*`, `DEEPSEEK_*`, `OPENAI_*`, `LLM_*` | All | As needed |

Mark LLM and **service role** keys as **sensitive**. Redeploy after changing variables.

Local: copy `.env.example` → `.env.local` (never commit secrets). `.gitignore` ignores `.env` and `.env*.local` but **keeps** `.env.example`.

### 4. Supabase (production)

1. **Authentication → URL configuration**
   - **Site URL:** `https://<your-production-domain>` (e.g. `https://chat-demo.vercel.app`).
   - **Redirect URLs:** add the same URL plus preview URLs if you use Supabase redirects, e.g. `https://*.vercel.app/**` (see [Supabase redirect docs](https://supabase.com/docs/guides/auth/redirect-urls)).
2. Run **`supabase/migrations/001_initial.sql`** on this Supabase project if not already applied.

### 5. Long streaming / plan limits

`app/api/chats/[chatId]/messages/route.ts` sets `export const maxDuration = 300` (**required static literal** in Next.js — env-based values break the build). That matches **Vercel Hobby**. On **Pro+**, edit the literal (e.g. to `600`) to match your plan’s [max duration](https://vercel.com/docs/functions/runtimes#max-duration), then redeploy.

### 6. Smoke test after deploy

- Open the production URL → **Open chat** (guest cookie on your domain).
- **Sign in / Register** and send a message with streaming.
- If auth loops or CORS errors appear, recheck Supabase **Site URL** and **Redirect URLs** for the exact Vercel hostname.

## Project layout

- `app/api/*` — route handlers only; DB and LLM run here.
- `server/*` — helpers imported **only** from API routes.
- `components/*`, `hooks/*`, `lib/*` (except env/admin) — UI and client fetch; **no direct DB** from components.

## Other LLMs (e.g. Gemini)

Stack uses Vercel **AI SDK** (`@ai-sdk/openai` v3). DeepSeek uses `createOpenAI({ baseURL: "https://api.deepseek.com/v1", apiKey }).chat(model)` so calls hit **chat/completions**, not OpenAI **Responses**. For **Gemini**, add a branch in `server/llm-pipeline.ts` or use `@ai-sdk/google`.
