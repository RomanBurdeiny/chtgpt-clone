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
import { registerSchema, type RegisterFormValues } from "@/lib/schemas/auth";

export default function RegisterPage() {
  const router = useRouter();
  const { session, loading } = useSupabaseAuth();
  const [busy, setBusy] = useState(false);

  const form = useForm<RegisterFormValues>({
    resolver: zodResolver(registerSchema),
    defaultValues: { email: "", password: "", confirmPassword: "" },
  });

  const onRegister = form.handleSubmit(async (values) => {
    setBusy(true);
    try {
      const supabase = createSupabaseBrowserClient();
      const { data, error } = await supabase.auth.signUp({
        email: values.email,
        password: values.password,
      });
      if (error) {
        toast.error(error.message);
        return;
      }
      if (data.session) {
        toast.success("Account created");
        router.push("/chat");
        router.refresh();
        return;
      }
      toast.info("Check your email, or disable email confirmation in Supabase (see README).");
    } finally {
      setBusy(false);
    }
  });

  if (loading) {
    return (
      <div className="flex min-h-[100dvh] items-center justify-center">
        <p className="text-muted-foreground text-sm">Loading…</p>
      </div>
    );
  }

  if (session) {
    return (
      <div className="mx-auto flex min-h-[100dvh] max-w-sm flex-col justify-center gap-6 px-4 text-center">
        <p className="text-muted-foreground text-sm">You are already signed in as {session.user.email}</p>
        <Link href="/chat" className={cn(buttonVariants(), "justify-center")} title="Go to chat">
          Go to chat
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto flex min-h-[100dvh] max-w-sm flex-col justify-center gap-6 px-4">
      <div>
        <h1 className="font-semibold text-2xl tracking-tight">Register</h1>
        <p className="mt-1 text-muted-foreground text-sm">Create an account with Supabase Auth.</p>
      </div>
      <form className="flex flex-col gap-4" onSubmit={onRegister} noValidate>
        <div className="space-y-2">
          <Label htmlFor="register-email">Email</Label>
          <Input
            id="register-email"
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
          <Label htmlFor="register-password">Password</Label>
          <Input
            id="register-password"
            type="password"
            autoComplete="new-password"
            aria-invalid={!!form.formState.errors.password}
            {...form.register("password")}
          />
          {form.formState.errors.password ? (
            <p className="text-destructive text-xs">{form.formState.errors.password.message}</p>
          ) : null}
        </div>
        <div className="space-y-2">
          <Label htmlFor="register-confirm">Confirm password</Label>
          <Input
            id="register-confirm"
            type="password"
            autoComplete="new-password"
            aria-invalid={!!form.formState.errors.confirmPassword}
            {...form.register("confirmPassword")}
          />
          {form.formState.errors.confirmPassword ? (
            <p className="text-destructive text-xs">{form.formState.errors.confirmPassword.message}</p>
          ) : null}
        </div>
        <Button type="submit" className="w-full" disabled={busy} title="Create your account">
          Create account
        </Button>
      </form>
      <p className="text-center text-muted-foreground text-sm">
        Already have an account?{" "}
        <Link
          href="/login"
          className="text-foreground font-medium underline underline-offset-4"
          title="Sign in instead"
        >
          Sign in
        </Link>
      </p>
      <Link
        href="/chat"
        className={cn(buttonVariants({ variant: "ghost" }), "justify-center")}
        title="Use the app without registering (guest quota applies)"
      >
        Continue as guest
      </Link>
    </div>
  );
}
