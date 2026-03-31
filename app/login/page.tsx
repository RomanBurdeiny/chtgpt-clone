"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { buttonVariants } from "@/lib/button-variants";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useSupabaseAuth } from "@/hooks/use-supabase-auth";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import { loginSchema, type LoginFormValues } from "@/lib/schemas/auth";

export default function LoginPage() {
  const router = useRouter();
  const { session, loading } = useSupabaseAuth();
  const [busy, setBusy] = useState(false);

  const form = useForm<LoginFormValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: "", password: "" },
  });

  const onSignIn = form.handleSubmit(async (values) => {
    setBusy(true);
    try {
      const supabase = createSupabaseBrowserClient();
      const { error } = await supabase.auth.signInWithPassword({
        email: values.email,
        password: values.password,
      });
      if (error) {
        const needsConfirm = /confirm|not confirmed|email.*verify/i.test(error.message);
        toast.error(error.message, {
          description: needsConfirm
            ? "In Supabase: Authentication → Providers → Email — disable “Confirm email” or confirm the user under Users."
            : undefined,
          duration: needsConfirm ? 9000 : 4000,
        });
        return;
      }
      toast.success("Signed in");
      router.push("/chat");
      router.refresh();
    } finally {
      setBusy(false);
    }
  });

  const onSignOut = async () => {
    setBusy(true);
    try {
      const supabase = createSupabaseBrowserClient();
      await supabase.auth.signOut();
      toast.success("Signed out");
      router.push("/chat");
      router.refresh();
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return (
      <div className="flex min-h-[100dvh] items-center justify-center">
        <p className="text-muted-foreground text-sm">Loading…</p>
      </div>
    );
  }

  if (session) {
    return (
      <div className="mx-auto flex min-h-[100dvh] max-w-sm flex-col justify-center gap-6 px-4">
        <h1 className="font-semibold text-2xl tracking-tight">Account</h1>
        <p className="text-muted-foreground text-sm">Signed in as {session.user.email}</p>
        <div className="flex flex-col gap-2">
          <Link
            href="/chat"
            className={cn(buttonVariants({ variant: "outline" }))}
            title="Go back to the chat"
          >
            Open chat
          </Link>
          <Button
            type="button"
            variant="destructive"
            disabled={busy}
            title="Sign out on this device"
            onClick={() => void onSignOut()}
          >
            Sign out
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto flex min-h-[100dvh] max-w-sm flex-col justify-center gap-6 px-4">
      <div>
        <h1 className="font-semibold text-2xl tracking-tight">Sign in</h1>
        <p className="mt-1 text-muted-foreground text-sm">Email and password from Supabase Auth.</p>
      </div>
      <form className="flex flex-col gap-4" onSubmit={onSignIn} noValidate>
        <div className="space-y-2">
          <Label htmlFor="login-email">Email</Label>
          <Input
            id="login-email"
            type="email"
            autoComplete="email"
            aria-invalid={!!form.formState.errors.email}
            {...form.register("email")}
          />
          {form.formState.errors.email ? (
            <p className="text-destructive text-xs">{form.formState.errors.email.message}</p>
          ) : null}
        </div>
        <div className="space-y-2">
          <Label htmlFor="login-password">Password</Label>
          <Input
            id="login-password"
            type="password"
            autoComplete="current-password"
            aria-invalid={!!form.formState.errors.password}
            {...form.register("password")}
          />
          {form.formState.errors.password ? (
            <p className="text-destructive text-xs">{form.formState.errors.password.message}</p>
          ) : null}
        </div>
        <Button type="submit" className="w-full" disabled={busy} title="Sign in with email and password">
          Sign in
        </Button>
      </form>
      <p className="text-center text-muted-foreground text-sm">
        No account?{" "}
        <Link
          href="/register"
          className="text-foreground font-medium underline underline-offset-4"
          title="Create a new account"
        >
          Register
        </Link>
      </p>
      <Link
        href="/chat"
        className={cn(buttonVariants({ variant: "ghost" }), "justify-center")}
        title="Use the app without signing in (guest quota applies)"
      >
        Continue as guest
      </Link>
    </div>
  );
}
