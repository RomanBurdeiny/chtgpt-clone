import Link from "next/link";

import { buttonVariants } from "@/lib/button-variants";
import { cn } from "@/lib/utils";

export default function Home() {
  return (
    <div className="flex min-h-[100dvh] flex-col items-center justify-center gap-8 px-4">
      <div className="max-w-lg text-center">
        <h1 className="font-semibold text-3xl tracking-tight">Chat demo</h1>
        <p className="mt-3 text-muted-foreground leading-relaxed">
          Streaming assistant with saved chats, attachments, document context, guest quota, and Supabase Auth.
        </p>
      </div>
      <div className="flex flex-wrap items-center justify-center gap-3">
        <Link href="/chat" className={cn(buttonVariants({ size: "lg" }))} title="Open the chat app">
          Open chat
        </Link>
        <Link
          href="/login"
          className={cn(buttonVariants({ variant: "outline", size: "lg" }))}
          title="Sign in with email and password"
        >
          Sign in
        </Link>
        <Link
          href="/register"
          className={cn(buttonVariants({ variant: "outline", size: "lg" }))}
          title="Create a new account"
        >
          Register
        </Link>
      </div>
    </div>
  );
}
