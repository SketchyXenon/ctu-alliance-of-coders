"use client";

import * as React from "react";
import { CheckCircle2, KeyRound, Lock, User, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { GearLogo } from "@/components/gear-logo";
import { api } from "@/lib/api-client";
import { validatePassword } from "@/lib/validation";

interface InviteRedeemFormProps {
  token: string;
  onDone: () => void;
}

export function InviteRedeemForm({ token, onDone }: InviteRedeemFormProps) {
  const [name, setName] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [confirm, setConfirm] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [submitting, setSubmitting] = React.useState(false);
  const [done, setDone] = React.useState<{ email: string } | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (submitting) return;
    setError(null);

    const passCheck = validatePassword(password, { minLen: 8, maxLen: 128 });
    if (!passCheck.valid || !passCheck.value) {
      setError(passCheck.error ?? "Password is required.");
      return;
    }
    if (password !== confirm) {
      setError("Passwords do not match.");
      return;
    }

    setSubmitting(true);
    const { data, error: apiError } = await api.post<{
      ok?: boolean;
      email?: string;
      message?: string;
    }>("/api/admin-invites/redeem", {
      token,
      name: name.trim() || null,
      password,
    });
    setSubmitting(false);

    if (apiError || !data || !data.ok) {
      setError(
        apiError?.message ?? "This invite link is invalid or has expired.",
      );
      return;
    }
    setPassword("");
    setConfirm("");
    setDone({ email: data.email ?? "" });
    toast.success("Account created", {
      description: "You can now sign in with your email and password.",
    });
  }

  if (done) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center px-4 py-12 pb-32 sm:px-6">
        <Card className="w-full max-w-md border-border/60 shadow-lg">
          <CardHeader className="items-center gap-3 text-center">
            <div className="flex w-full justify-center">
              <GearLogo size={56} />
            </div>
            <div className="space-y-1">
              <CardTitle className="flex items-center justify-center gap-2 font-display text-2xl">
                <CheckCircle2
                  className="size-5 text-emerald-500"
                  aria-hidden="true"
                />
                Account created
              </CardTitle>
              <CardDescription>
                Your administrator account for{" "}
                <span className="font-medium text-foreground">
                  {done.email}
                </span>{" "}
                is ready.
              </CardDescription>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <Alert>
              <KeyRound aria-hidden="true" />
              <AlertTitle>Next step: sign in</AlertTitle>
              <AlertDescription>
                Sign in with your email and password. A one-time verification
                code will be sent to your email to complete sign-in.
              </AlertDescription>
            </Alert>
            <Button type="button" className="w-full" size="lg" onClick={onDone}>
              Continue to sign in
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="flex min-h-[50vh] items-center justify-center px-4 py-12 pb-32 sm:px-6">
      <Card className="w-full max-w-md border-border/60 shadow-lg">
        <CardHeader className="items-center gap-3 text-center">
          <div className="flex w-full justify-center">
            <GearLogo size={56} />
          </div>
          <div className="space-y-1">
            <CardTitle className="font-display text-2xl">
              Accept Admin Invite
            </CardTitle>
            <CardDescription>
              Set your password to activate your administrator account.
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4" noValidate>
            <div className="space-y-2">
              <Label
                htmlFor="redeem-name"
                className="text-xs uppercase tracking-wider"
              >
                <User className="size-3.5" aria-hidden="true" />
                Name (optional)
              </Label>
              <Input
                id="redeem-name"
                type="text"
                autoComplete="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Your name"
                disabled={submitting}
                maxLength={100}
              />
            </div>
            <div className="space-y-2">
              <Label
                htmlFor="redeem-password"
                className="text-xs uppercase tracking-wider"
              >
                <Lock className="size-3.5" aria-hidden="true" />
                Password
              </Label>
              <Input
                id="redeem-password"
                type="password"
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="At least 8 characters"
                disabled={submitting}
                aria-required="true"
              />
            </div>
            <div className="space-y-2">
              <Label
                htmlFor="redeem-confirm"
                className="text-xs uppercase tracking-wider"
              >
                <Lock className="size-3.5" aria-hidden="true" />
                Confirm password
              </Label>
              <Input
                id="redeem-confirm"
                type="password"
                autoComplete="new-password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                placeholder="Re-enter your password"
                disabled={submitting}
                aria-required="true"
              />
            </div>

            {error && (
              <Alert variant="destructive" role="alert">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}

            <Button
              type="submit"
              className="w-full"
              size="lg"
              disabled={submitting}
            >
              {submitting ? (
                <>
                  <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                  Activating...
                </>
              ) : (
                <>
                  <KeyRound aria-hidden="true" />
                  Activate account
                </>
              )}
            </Button>
          </form>
          <p className="mt-5 text-center text-[11px] text-muted-foreground">
            After activation you'll sign in with your password plus an email
            verification code.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
