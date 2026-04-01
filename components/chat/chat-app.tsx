"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Check,
  Copy,
  Loader2,
  Menu,
  MessageSquarePlus,
  Paperclip,
  SendHorizontal,
  Sparkles,
  X,
} from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { buttonVariants } from "@/lib/button-variants";
import { cn } from "@/lib/utils";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { useChatsRealtime } from "@/hooks/use-chats-realtime";
import { useSmoothStreamText } from "@/hooks/use-smooth-stream-text";
import { useSupabaseAuth } from "@/hooks/use-supabase-auth";
import { ChatMarkdown } from "@/components/chat/chat-markdown";
import { broadcastChatWorkspaceStale, subscribeChatWorkspaceStale } from "@/lib/cross-tab";
import { isAbortError, postChatMessageStream } from "@/lib/chat/ndjson-stream";
import type { GuestUsage } from "@/lib/guest-usage";
import { apiFetch } from "@/lib/http/client";

const CHATS_QK = ["chats"] as const;
const chatDetailKey = (scope: string, id: string) => ["chat", scope, id] as const;

type ChatListItem = { id: string; title: string; updatedAt: string };
type AttachmentMeta = { id: string; mimeType: string; kind: string; url?: string };
type MessageRow = {
  id: string;
  role: string;
  content: string;
  sequence: number;
  createdAt?: string;
  attachments?: AttachmentMeta[];
};

type ChatDetail = { id: string; title: string; updatedAt?: string; messages: MessageRow[] };

function MessageAttachmentList({ attachments }: { attachments: AttachmentMeta[] }) {
  if (!attachments.length) return null;
  const imagesOk = attachments.filter((a) => a.kind === "image" && a.url);
  const chips = attachments.filter((a) => a.kind === "document" || (a.kind === "image" && !a.url));
  return (
    <div className="flex flex-col gap-2">
      {imagesOk.length ? (
        <div className="flex flex-wrap gap-2">
          {imagesOk.map((a) => (
            <div key={a.id} className="relative h-28 w-28 overflow-hidden rounded-lg border">
              <Image src={a.url!} alt="" fill className="object-cover" unoptimized />
            </div>
          ))}
        </div>
      ) : null}
      {chips.length ? (
        <div className="flex flex-wrap gap-2">
          {chips.map((a) => (
            <span
              key={a.id}
              className="rounded-lg border bg-muted px-2 py-1 text-muted-foreground text-xs"
            >
              {a.kind === "image" ? "Image" : "Document"} · {a.mimeType}
              {!a.url && a.kind === "image" ? " · preview soon" : ""}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function CopyMessageButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const onCopy = async () => {
    const t = text.trim();
    if (!t) return;
    try {
      await navigator.clipboard.writeText(t);
      setCopied(true);
      toast.success("Copied to clipboard");
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      toast.error("Could not copy");
    }
  };
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-sm"
      className="shrink-0 -mr-1 h-7 w-7 text-muted-foreground hover:text-foreground"
      title="Copy reply"
      aria-label="Copy reply"
      onClick={() => void onCopy()}
    >
      {copied ? <Check className="size-3.5 text-emerald-600 dark:text-emerald-400" aria-hidden /> : <Copy className="size-3.5" aria-hidden />}
    </Button>
  );
}

export function ChatApp() {
  const queryClient = useQueryClient();
  const { session, loading: authLoading, accessToken, isLoggedIn } = useSupabaseAuth();
  const [pickedChatId, setPickedChatId] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [pendingAtts, setPendingAtts] = useState<AttachmentMeta[]>([]);
  const [removingAttachmentId, setRemovingAttachmentId] = useState<string | null>(null);
  const [streamText, setStreamText] = useState("");
  const [sending, setSending] = useState(false);
  /** Smoother on-screen reveal than raw NDJSON chunks */
  const streamVisualActive = sending && streamText.length > 0;
  const displayStreamText = useSmoothStreamText(streamText, streamVisualActive);
  /** Показ сразу после отправки, пока из стрима не придёт user_message и не попасть в кэш */
  const [pendingOptimisticUser, setPendingOptimisticUser] = useState<{
    content: string;
    attachments: AttachmentMeta[];
    clientKey: string;
  } | null>(null);
  /** Диагностика ожидания ответа: отличаем «ждём сеть» от «модель считает». */
  const [streamHttpOk, setStreamHttpOk] = useState(false);
  const [streamFirstChunk, setStreamFirstChunk] = useState(false);
  const [sendElapsedSec, setSendElapsedSec] = useState(0);
  const streamAbort = useRef<AbortController | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!sending) {
      setSendElapsedSec(0);
      return;
    }
    setSendElapsedSec(0);
    const id = window.setInterval(() => setSendElapsedSec((s) => s + 1), 1000);
    return () => window.clearInterval(id);
  }, [sending]);

  useChatsRealtime(isLoggedIn, session?.user?.id ?? null);

  useEffect(() => {
    return subscribeChatWorkspaceStale(() => {
      void queryClient.invalidateQueries({ queryKey: [...CHATS_QK] });
      void queryClient.invalidateQueries({ queryKey: ["chat"] });
    });
  }, [queryClient]);

  const guestBootstrap = useMutation({
    mutationFn: async () => {
      const r = await apiFetch("/api/guest/session", { method: "POST" });
      if (!r.ok) {
        let msg = `HTTP ${r.status}`;
        try {
          const j = (await r.json()) as { error?: { message?: string } };
          if (j.error?.message) msg = j.error.message;
        } catch {
          /* ignore */
        }
        throw new Error(msg);
      }
      return r.json() as Promise<GuestUsage>;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["guest", "me"] });
      broadcastChatWorkspaceStale();
    },
    onError: (err) => {
      toast.error("Could not create guest session", {
        description: err instanceof Error ? err.message : "Check Supabase config and run the SQL migration.",
      });
    },
  });

  const guestMe = useQuery({
    queryKey: ["guest", "me"],
    queryFn: async () => {
      const r = await apiFetch("/api/guest/session");
      if (r.status === 404) return null;
      if (!r.ok) throw new Error("guest me failed");
      return r.json() as Promise<GuestUsage>;
    },
    enabled: !isLoggedIn && !authLoading,
    retry: false,
  });

  useEffect(() => {
    if (isLoggedIn || authLoading) return;
    if (!guestMe.isFetched) return;
    if (guestMe.data !== null) return;
    if (guestBootstrap.isPending || guestBootstrap.isSuccess || guestBootstrap.isError) return;
    guestBootstrap.mutate();
  }, [isLoggedIn, authLoading, guestMe.isFetched, guestMe.data, guestBootstrap]);

  const guestUsage: GuestUsage | null = isLoggedIn ? null : (guestMe.data ?? guestBootstrap.data ?? null);
  const sessionReady =
    isLoggedIn ||
    (guestMe.isSuccess && guestMe.data !== null) ||
    (guestBootstrap.isSuccess && guestBootstrap.data !== null);
  const sessionBootLoading =
    !isLoggedIn &&
    (authLoading || !guestMe.isFetched || guestMe.isLoading || guestBootstrap.isPending);

  const chatWorkspaceScope = useMemo(() => {
    if (isLoggedIn) return `u:${session?.user?.id ?? ""}` as const;
    const sid = guestMe.data?.sessionId ?? guestBootstrap.data?.sessionId;
    return sid ? (`g:${sid}` as const) : ("g:pending" as const);
  }, [isLoggedIn, session?.user?.id, guestMe.data?.sessionId, guestBootstrap.data?.sessionId]);

  const chatsQueryKey = useMemo(() => [...CHATS_QK, chatWorkspaceScope] as const, [chatWorkspaceScope]);

  const chatsQuery = useQuery({
    queryKey: chatsQueryKey,
    queryFn: async () => {
      const r = await apiFetch("/api/chats", { accessToken });
      if (!r.ok) throw new Error("list failed");
      const j = (await r.json()) as { items: ChatListItem[] };
      return j.items;
    },
    enabled: sessionReady,
  });

  const activeChatId = useMemo(() => {
    const rows = chatsQuery.data;
    if (!rows?.length) return null;
    if (pickedChatId && rows.some((c) => c.id === pickedChatId)) return pickedChatId;
    return rows[0].id;
  }, [chatsQuery.data, pickedChatId]);

  const chatDetail = useQuery({
    queryKey: activeChatId ? chatDetailKey(chatWorkspaceScope, activeChatId) : ["chat", "none"],
    queryFn: async () => {
      const r = await apiFetch(`/api/chats/${activeChatId}`, { accessToken });
      if (!r.ok) throw new Error("detail failed");
      return r.json() as Promise<ChatDetail>;
    },
    enabled: Boolean(activeChatId && sessionReady),
  });

  const createChat = useMutation({
    mutationFn: async () => {
      const r = await apiFetch("/api/chats", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
        accessToken,
      });
      if (!r.ok) throw new Error("create failed");
      return r.json() as Promise<ChatListItem>;
    },
    onSuccess: (c) => {
      setPickedChatId(c.id);
      void queryClient.invalidateQueries({ queryKey: [...CHATS_QK] });
      broadcastChatWorkspaceStale();
      toast.success("New chat created");
    },
    onError: () => toast.error("Could not create chat"),
  });

  const deleteChat = useMutation({
    mutationFn: async (id: string) => {
      const r = await apiFetch(`/api/chats/${id}`, { method: "DELETE", accessToken });
      if (!r.ok) throw new Error("delete failed");
    },
    onSuccess: () => {
      setPickedChatId(null);
      void queryClient.invalidateQueries({ queryKey: [...CHATS_QK] });
      void queryClient.invalidateQueries({ queryKey: ["chat"] });
      broadcastChatWorkspaceStale();
    },
    onError: () => toast.error("Could not delete chat"),
  });

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [
    chatDetail.data?.messages?.length,
    streamText,
    pendingOptimisticUser?.clientKey,
    sending,
  ]);

  const canSendGuest = isLoggedIn || (guestUsage && guestUsage.remaining > 0);
  const canCompose = sessionReady && canSendGuest;
  /** Как у textarea: не даём жать «Отправить», пока сессия/лимит не готовы */
  const disabledSend = sending || !input.trim() || !canCompose;

  const assistantWaitHint = useMemo(() => {
    if (!sending || streamText.trim()) return null;
    if (!streamHttpOk) {
      return {
        title: "Sending request…",
        detail:
          "If the timer keeps going, the request is still in flight. You would see an error toast immediately if something failed.",
      };
    }
    if (!streamFirstChunk) {
      return {
        title: "Request accepted, waiting for stream…",
        detail:
          "The server returned OK and is preparing the reply (saving your message, starting the model).",
      };
    }
    return {
      title: "Model is replying…",
      detail:
        "Bytes are flowing; visible text can take a moment with a busy provider or a large context.",
    };
  }, [sending, streamText, streamHttpOk, streamFirstChunk]);

  const onSend = useCallback(async () => {
    let chatId = activeChatId;
    const text = input.trim();
    if (!canCompose) {
      toast.error("Session not ready", { description: "Wait a moment or refresh the page." });
      return;
    }
    if (!canSendGuest) {
      toast.error("Cannot send messages", {
        description: isLoggedIn ? undefined : "Sign in for full access.",
      });
      return;
    }
    if (!text || sending) return;
    if (!chatId) {
      const r = await apiFetch("/api/chats", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
        accessToken,
      });
      if (!r.ok) {
        toast.error("Could not create chat");
        return;
      }
      const c = (await r.json()) as ChatListItem;
      chatId = c.id;
      if (!chatId) {
        toast.error("Could not create chat");
        return;
      }
      setPickedChatId(c.id);
      await queryClient.invalidateQueries({ queryKey: [...CHATS_QK] });
      broadcastChatWorkspaceStale();
      try {
        await queryClient.fetchQuery({
          queryKey: chatDetailKey(chatWorkspaceScope, chatId),
          queryFn: async () => {
            const d = await apiFetch(`/api/chats/${chatId}`, { accessToken });
            if (!d.ok) throw new Error("Chat not ready");
            return d.json() as Promise<ChatDetail>;
          },
        });
      } catch {
        toast.error("Chat was created but could not be loaded", {
          description: "Refresh the page or try again.",
        });
        return;
      }
    }
    streamAbort.current?.abort();
    streamAbort.current = new AbortController();

    const clientMessageId =
      typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : undefined;
    const clientKey = clientMessageId ?? `local-${Date.now()}`;
    const attachmentIds = pendingAtts.map((a) => a.id);
    const attachmentsSnapshot = [...pendingAtts];

    setPendingOptimisticUser({ content: text, attachments: attachmentsSnapshot, clientKey });
    setStreamHttpOk(false);
    setStreamFirstChunk(false);
    setSending(true);
    setStreamText("");
    setInput("");
    setPendingAtts([]);

    let accumulated = "";

    try {
      await postChatMessageStream({
        chatId,
        accessToken,
        signal: streamAbort.current.signal,
        body: { content: text, clientMessageId, attachmentIds: attachmentIds.length ? attachmentIds : undefined },
        onHttpOk: () => setStreamHttpOk(true),
        onFirstChunk: () => setStreamFirstChunk(true),
        onLine: (line) => {
          if (line.type === "user_message") {
            const raw = line.message as {
              id: string;
              role: string;
              content: string;
              sequence?: number;
              createdAt?: string;
              attachments?: AttachmentMeta[];
            };
            queryClient.setQueryData<ChatDetail | undefined>(
              chatDetailKey(chatWorkspaceScope, chatId),
              (prev) => {
                const base: ChatDetail =
                  prev ?? {
                    id: chatId,
                    title: "New chat",
                    messages: [],
                  };
                if (base.messages.some((m) => m.id === raw.id)) return base;
                return {
                  ...base,
                  messages: [
                    ...base.messages,
                    {
                      id: raw.id,
                      role: raw.role,
                      content: raw.content,
                      sequence: raw.sequence ?? base.messages.length,
                      createdAt: raw.createdAt,
                      attachments: raw.attachments,
                    },
                  ],
                };
              },
            );
            setPendingOptimisticUser(null);
            return;
          }
          if (line.type === "delta") {
            accumulated += line.text;
            setStreamText(accumulated);
          }
          if (line.type === "error") {
            toast.error(line.message);
          }
        },
      });
      void queryClient.invalidateQueries({ queryKey: [...CHATS_QK] });
      broadcastChatWorkspaceStale();
      if (!isLoggedIn) void queryClient.invalidateQueries({ queryKey: ["guest", "me"] });
      await queryClient.refetchQueries({ queryKey: chatDetailKey(chatWorkspaceScope, chatId) });
    } catch (e) {
      setPendingOptimisticUser(null);
      if (!isAbortError(e)) toast.error(e instanceof Error ? e.message : "Send failed");
    } finally {
      setStreamHttpOk(false);
      setStreamFirstChunk(false);
      setSending(false);
      setStreamText("");
      streamAbort.current = null;
    }
  }, [
    activeChatId,
    chatWorkspaceScope,
    input,
    sending,
    canCompose,
    canSendGuest,
    pendingAtts,
    accessToken,
    queryClient,
    isLoggedIn,
  ]);

  const onUpload = async (file: File) => {
    let chatId = activeChatId;
    if (!chatId) {
      const r = await apiFetch("/api/chats", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
        accessToken,
      });
      if (!r.ok) {
        toast.error("Could not create chat for upload");
        return;
      }
      const c = (await r.json()) as ChatListItem;
      chatId = c.id;
      setPickedChatId(c.id);
      await queryClient.invalidateQueries({ queryKey: [...CHATS_QK] });
      broadcastChatWorkspaceStale();
    }
    if (pendingAtts.length >= 4) {
      toast.error("Maximum 4 attachments per message");
      return;
    }
    const fd = new FormData();
    fd.append("file", file);
    const r = await apiFetch(`/api/chats/${chatId}/attachments`, {
      method: "POST",
      body: fd,
      accessToken,
    });
    if (!r.ok) {
      toast.error("Upload failed");
      return;
    }
    const j = (await r.json()) as AttachmentMeta;
    setPendingAtts((p) => [...p, j]);
  };

  const removePendingAttachment = async (attachmentId: string) => {
    const chatId = activeChatId ?? pickedChatId;
    if (!chatId) {
      toast.error("Cannot remove attachment", { description: "No chat selected." });
      return;
    }
    setRemovingAttachmentId(attachmentId);
    try {
      const r = await apiFetch(`/api/chats/${chatId}/attachments/${attachmentId}`, {
        method: "DELETE",
        accessToken,
      });
      if (r.status === 204) {
        setPendingAtts((p) => p.filter((a) => a.id !== attachmentId));
        return;
      }
      let msg = `HTTP ${r.status}`;
      try {
        const j = (await r.json()) as { error?: { message?: string } };
        if (j.error?.message) msg = j.error.message;
      } catch {
        /* ignore */
      }
      toast.error("Could not remove attachment", { description: msg });
    } finally {
      setRemovingAttachmentId(null);
    }
  };

  const onPaste = (e: React.ClipboardEvent) => {
    const files = Array.from(e.clipboardData.files ?? []);
    const img = files.find((f) => f.type.startsWith("image/"));
    if (img) {
      e.preventDefault();
      void onUpload(img);
    }
  };

  const Sidebar = (
    <div className="flex h-full flex-col gap-2 border-border border-r bg-sidebar p-3">
      <div className="flex items-center justify-between gap-2 px-1">
        <span className="flex items-center gap-2 font-semibold text-sidebar-foreground text-sm">
          <Sparkles className="size-4 opacity-70" />
          Chats
        </span>
        <Button
          type="button"
          size="icon-sm"
          variant="outline"
          className="shrink-0"
          disabled={createChat.isPending || !sessionReady}
          onClick={() => createChat.mutate()}
          title="Start a new conversation"
          aria-label="Start a new conversation"
        >
          <MessageSquarePlus className="size-4" />
        </Button>
      </div>
      <Separator />
      <ScrollArea className="min-h-0 flex-1 pr-2">
        {chatsQuery.isLoading ? (
          <div className="space-y-2 animate-in fade-in duration-200">
            <Skeleton className="h-11 w-full rounded-lg" />
            <Skeleton className="h-11 w-full rounded-lg" />
            <Skeleton className="h-11 w-full rounded-lg" />
          </div>
        ) : !chatsQuery.data?.length ? (
          <div className="flex animate-in fade-in slide-in-from-bottom-1 flex-col items-center gap-3 px-2 py-10 text-center duration-200">
            <div className="rounded-full bg-sidebar-accent p-3">
              <MessageSquarePlus className="size-6 text-muted-foreground" aria-hidden />
            </div>
            <p className="max-w-[15rem] text-muted-foreground text-sm leading-relaxed">
              No conversations yet. Tap + above to start one.
            </p>
          </div>
        ) : (
          <ul className="flex flex-col gap-1">
            {chatsQuery.data.map((c) => {
              const isDeleting = deleteChat.isPending && deleteChat.variables === c.id;
              return (
                <li key={c.id}>
                  <div
                    role="button"
                    tabIndex={0}
                    onClick={() => setPickedChatId(c.id)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        setPickedChatId(c.id);
                      }
                    }}
                    className={cn(
                      "group flex w-full cursor-pointer items-center gap-1.5 rounded-lg px-2 py-2 text-left text-sm transition-[background-color,transform] duration-200 hover:bg-sidebar-accent active:scale-[0.997]",
                      c.id === activeChatId && "bg-sidebar-accent",
                      c.id === activeChatId && "font-medium",
                    )}
                  >
                    <span className="min-w-0 flex-1 truncate">{c.title}</span>
                    <Button
                      type="button"
                      size="icon-lg"
                      variant="ghost"
                      className={cn(
                        "shrink-0 text-muted-foreground transition-colors hover:bg-destructive/15 hover:text-destructive",
                        "opacity-80 group-hover:opacity-100 sm:opacity-70",
                      )}
                      disabled={isDeleting}
                      title="Delete this conversation"
                      aria-label="Delete this conversation"
                      onClick={(ev) => {
                        ev.stopPropagation();
                        void deleteChat.mutateAsync(c.id);
                      }}
                    >
                      {isDeleting ? (
                        <Loader2 className="size-5 animate-spin" aria-hidden />
                      ) : (
                        <X className="size-5" strokeWidth={2.25} aria-hidden />
                      )}
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </ScrollArea>
    </div>
  );

  return (
    <div className="flex h-[100dvh] flex-col bg-background md:flex-row">
      <aside className="hidden w-72 shrink-0 md:flex md:flex-col">{Sidebar}</aside>

      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <header className="flex shrink-0 items-center gap-2 border-b px-3 py-2">
          <Sheet>
            <SheetTrigger
              className={cn(
                buttonVariants({ variant: "ghost", size: "icon" }),
                "md:hidden",
              )}
              aria-label="Open sidebar"
            >
              <Menu className="size-5" />
            </SheetTrigger>
            <SheetContent side="left" className="w-72 p-0">
              {Sidebar}
            </SheetContent>
          </Sheet>
          <h1 className="min-w-0 flex-1 truncate font-medium text-sm md:text-base">
            {chatDetail.data?.title ?? "Chat"}
          </h1>
          <div className="flex shrink-0 items-center gap-2">
            {!isLoggedIn && guestUsage ? (
              <span className="hidden rounded-full bg-secondary px-2 py-1 text-secondary-foreground text-xs sm:inline">
                {guestUsage.remaining} / {guestUsage.limit} free
              </span>
            ) : null}
            {isLoggedIn ? (
              <Link
                href="/login"
                title="Open account — sign out or return to chat"
                className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
              >
                Account
              </Link>
            ) : (
              <Link
                href="/login"
                title="Sign in to save chats and unlock full quota"
                className={cn(buttonVariants({ size: "sm" }))}
              >
                Sign in
              </Link>
            )}
          </div>
        </header>

        {sessionBootLoading ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-4 p-6">
            <div className="flex flex-col items-center gap-2 text-center animate-in fade-in duration-300">
              <Loader2 className="size-8 animate-spin text-muted-foreground" aria-hidden />
              <p className="text-muted-foreground text-sm">Preparing session…</p>
            </div>
            <div className="w-full max-w-md space-y-3">
              <Skeleton className="h-14 w-full rounded-2xl" />
              <Skeleton className="ml-auto h-12 w-[88%] rounded-2xl" />
            </div>
          </div>
        ) : (
          <>
            <ScrollArea className="min-h-0 flex-1">
              <div className="mx-auto flex max-w-3xl flex-col gap-4 px-3 py-4">
                {!guestUsage && !isLoggedIn ? (
                  <p className="text-center text-destructive text-sm">Could not start session. Refresh the page.</p>
                ) : null}

                {!isLoggedIn && guestUsage && guestUsage.remaining === 0 ? (
                  <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-amber-950 text-sm dark:text-amber-100">
                    You have used all free questions.{" "}
                    <Link href="/login" className="font-medium underline underline-offset-2">
                      Sign in
                    </Link>{" "}
                    to continue.
                  </div>
                ) : null}

                {chatDetail.isLoading && !chatDetail.data && !pendingOptimisticUser && !sending ? (
                  <div className="space-y-3 animate-in fade-in duration-200">
                    <Skeleton className="h-20 w-[85%] rounded-2xl" />
                    <Skeleton className="ml-auto h-16 w-[75%] rounded-2xl" />
                  </div>
                ) : !(chatDetail.data?.messages?.length || pendingOptimisticUser || sending || streamText) ? (
                  <div className="flex flex-col items-center justify-center gap-4 px-2 py-16 text-center sm:py-20 animate-in fade-in zoom-in-95 duration-300">
                    <div className="rounded-full bg-muted p-4 shadow-sm ring-1 ring-border/60">
                      <Sparkles className="size-9 text-muted-foreground" aria-hidden />
                    </div>
                    <div className="max-w-sm space-y-1">
                      <p className="font-medium text-foreground text-sm">Start a conversation</p>
                      <p className="text-muted-foreground text-sm leading-relaxed">
                        Ask a question, attach an image, or upload PDFs and text files for context.
                      </p>
                    </div>
                  </div>
                ) : (
                  <ul className="flex flex-col gap-4">
                    {chatDetail.data?.messages?.map((m) => (
                      <li
                        key={m.id}
                        className={
                          "flex flex-col gap-2 rounded-2xl px-4 py-3 text-sm leading-relaxed transition-colors " +
                          (m.role === "user"
                            ? "ml-8 border border-border bg-card"
                            : "mr-8 bg-muted/60")
                        }
                      >
                        <div className="flex items-start justify-between gap-2">
                          <span className="font-medium text-muted-foreground text-xs uppercase tracking-wide">
                            {m.role === "user" ? "You" : "Assistant"}
                          </span>
                          {m.role === "assistant" && m.content.trim() ? (
                            <CopyMessageButton text={m.content} />
                          ) : null}
                        </div>
                        {m.attachments?.length ? <MessageAttachmentList attachments={m.attachments} /> : null}
                        <ChatMarkdown content={m.content} className="text-sm leading-relaxed" />
                      </li>
                    ))}
                    {pendingOptimisticUser ? (
                      <li
                        key={pendingOptimisticUser.clientKey}
                        className="flex animate-in fade-in duration-200 flex-col gap-2 rounded-2xl border border-border bg-card px-4 py-3 text-sm leading-relaxed ml-8"
                      >
                        <span className="font-medium text-muted-foreground text-xs uppercase tracking-wide">You</span>
                        {pendingOptimisticUser.attachments.length ? (
                          <div className="flex flex-wrap gap-2">
                            {pendingOptimisticUser.attachments.map((a) => (
                              <span
                                key={a.id}
                                className="rounded-lg border bg-muted px-2 py-1 text-muted-foreground text-xs"
                              >
                                {a.kind === "image" ? "Image" : "File"} · {a.mimeType}
                              </span>
                            ))}
                          </div>
                        ) : null}
                        <ChatMarkdown content={pendingOptimisticUser.content} className="text-sm leading-relaxed" />
                      </li>
                    ) : null}
                    {sending && !streamText ? (
                      <li className="mr-8 flex animate-in fade-in duration-200 flex-col gap-2 rounded-2xl bg-muted/60 px-4 py-3 text-sm leading-relaxed">
                        <span className="font-medium text-muted-foreground text-xs uppercase tracking-wide">
                          Assistant
                        </span>
                        <div className="mt-1 flex items-start gap-2 text-muted-foreground">
                          <Loader2 className="mt-0.5 size-4 shrink-0 animate-spin" aria-hidden />
                          <div className="min-w-0 flex-1 space-y-1">
                            <p className="text-foreground text-sm">
                              {assistantWaitHint?.title ?? "Waiting for reply…"}
                              <span className="ml-2 tabular-nums text-muted-foreground">
                                {sendElapsedSec}s
                              </span>
                            </p>
                            {assistantWaitHint ? (
                              <p className="text-muted-foreground text-xs leading-relaxed">
                                {assistantWaitHint.detail}
                              </p>
                            ) : null}
                          </div>
                        </div>
                      </li>
                    ) : null}
                    {streamText ? (
                      <li className="mr-8 rounded-2xl bg-muted/60 px-4 py-3 text-sm leading-relaxed">
                        <div className="flex items-start justify-between gap-2">
                          <span className="font-medium text-muted-foreground text-xs uppercase tracking-wide">
                            Assistant
                          </span>
                          {streamText.trim() ? <CopyMessageButton text={streamText} /> : null}
                        </div>
                        <div className="mt-2 min-w-0">
                          <ChatMarkdown
                            content={displayStreamText}
                            className="text-sm leading-relaxed"
                            streamCaret
                          />
                        </div>
                      </li>
                    ) : null}
                    <div ref={bottomRef} />
                  </ul>
                )}
              </div>
            </ScrollArea>

            <div className="shrink-0 border-t bg-background/80 p-3 backdrop-blur supports-[backdrop-filter]:bg-background/70">
              {pendingAtts.length ? (
                <div className="mx-auto mb-2 flex max-w-3xl flex-wrap gap-2">
                  {pendingAtts.map((a) => (
                    <div
                      key={a.id}
                      className="flex max-w-full items-center gap-1 rounded-md border bg-muted py-1 pl-2 pr-0.5 text-muted-foreground text-xs"
                    >
                      <span className="min-w-0 truncate">
                        {a.kind === "image" ? "Image" : "Document"} · {a.mimeType}
                      </span>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        className="h-7 w-7 shrink-0 text-muted-foreground hover:text-foreground"
                        title="Remove attachment"
                        aria-label="Remove attachment"
                        disabled={sending || removingAttachmentId === a.id}
                        onClick={() => void removePendingAttachment(a.id)}
                      >
                        {removingAttachmentId === a.id ? (
                          <Loader2 className="size-3.5 animate-spin" aria-hidden />
                        ) : (
                          <X className="size-3.5" aria-hidden />
                        )}
                      </Button>
                    </div>
                  ))}
                </div>
              ) : null}
              <div className="mx-auto flex max-w-3xl items-center gap-2">
                <label
                  className="inline-flex shrink-0 cursor-pointer self-center"
                  title="Attach an image, PDF, or text file"
                >
                  <input
                    type="file"
                    accept="image/*,.pdf,.txt,.md"
                    className="sr-only"
                    onChange={(ev) => {
                      const f = ev.target.files?.[0];
                      ev.target.value = "";
                      if (f) void onUpload(f);
                    }}
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    className="pointer-events-none"
                    title="Attach a file"
                    aria-label="Attach a file"
                  >
                    <Paperclip className="size-4" />
                  </Button>
                </label>
                <Textarea
                  ref={textareaRef}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onPaste={onPaste}
                  placeholder={
                    !sessionReady
                      ? "Loading session…"
                      : !canSendGuest
                        ? isLoggedIn
                          ? "You cannot send messages right now"
                          : "Guest limit reached — sign in to continue"
                        : "Ask anything...."
                  }
                  disabled={sending || !canCompose}
                  className="min-h-[52px] flex-1 resize-none self-center"
                  onKeyDown={(e) => {
                    if (e.nativeEvent.isComposing) return;
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      void onSend();
                    }
                  }}
                />
                <Button
                  type="button"
                  size="icon"
                  className="shrink-0 self-center"
                  disabled={disabledSend}
                  title="Send message (Enter)"
                  aria-label="Send message"
                  onClick={() => void onSend()}
                >
                  <SendHorizontal className="size-4" />
                </Button>
              </div>
              {sending ? (
                <p className="mx-auto mt-2 max-w-3xl text-muted-foreground text-xs">
                  {streamText.trim()
                    ? `Typing… ${sendElapsedSec}s`
                    : assistantWaitHint
                      ? `${assistantWaitHint.title} · ${sendElapsedSec}s`
                      : `Waiting for reply… · ${sendElapsedSec}s`}
                </p>
              ) : null}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
