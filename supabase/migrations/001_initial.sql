-- Run in Supabase SQL Editor (or via CLI). Service-role API bypasses RLS; RLS on chats enables Realtime filters for authenticated clients.

create table if not exists public.guest_sessions (
  id uuid primary key default gen_random_uuid(),
  token_hash text not null unique,
  free_questions_used int not null default 0,
  free_questions_limit int not null default 3,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz
);

create table if not exists public.chats (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users (id) on delete cascade,
  guest_session_id uuid references public.guest_sessions (id) on delete cascade,
  title text not null default 'New chat',
  updated_at timestamptz not null default now(),
  constraint chats_owner_chk check (
    (user_id is not null and guest_session_id is null)
    or (user_id is null and guest_session_id is not null)
  )
);

create index if not exists chats_user_updated_idx on public.chats (user_id, updated_at desc);
create index if not exists chats_guest_updated_idx on public.chats (guest_session_id, updated_at desc);

create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  chat_id uuid not null references public.chats (id) on delete cascade,
  role text not null check (role in ('user', 'assistant')),
  content text not null default '',
  sequence int not null,
  client_message_id text,
  created_at timestamptz not null default now(),
  constraint messages_chat_sequence_uniq unique (chat_id, sequence)
);

create unique index if not exists messages_client_message_idx
  on public.messages (chat_id, client_message_id)
  where client_message_id is not null;

create index if not exists messages_chat_seq_idx on public.messages (chat_id, sequence);

create table if not exists public.chat_attachments (
  id uuid primary key default gen_random_uuid(),
  chat_id uuid not null references public.chats (id) on delete cascade,
  message_id uuid references public.messages (id) on delete set null,
  storage_path text not null,
  mime_type text not null,
  kind text not null check (kind in ('image', 'document')),
  extracted_text text,
  created_at timestamptz not null default now()
);

create index if not exists chat_attachments_chat_idx on public.chat_attachments (chat_id);

alter table public.chats enable row level security;

drop policy if exists "chats_select_own" on public.chats;
create policy "chats_select_own"
  on public.chats
  for select
  to authenticated
  using (user_id = auth.uid());

-- Realtime: allow authenticated subscribers to receive their chat rows (writes only via API + service role).
-- If this errors with "already in publication", the table is already replicated — ignore.
alter publication supabase_realtime add table public.chats;

insert into storage.buckets (id, name, public)
values ('chat-uploads', 'chat-uploads', false)
on conflict (id) do nothing;
