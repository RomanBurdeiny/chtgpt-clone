"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";

import { createSupabaseBrowserClient } from "@/lib/supabase/browser";

const CHATS_KEY = ["chats"] as const;

export function useChatsRealtime(enabled: boolean, userId: string | null) {
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!enabled || !userId) return;
    const supabase = createSupabaseBrowserClient();

    const channel = supabase
      .channel(`chats:${userId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "chats", filter: `user_id=eq.${userId}` },
        () => {
          void queryClient.invalidateQueries({ queryKey: [...CHATS_KEY] });
        },
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [enabled, userId, queryClient]);
}
