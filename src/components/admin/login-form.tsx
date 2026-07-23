"use client";

import * as React from "react";
import { Lock, LogIn, Mail, ShieldAlert } from "lucide-react";
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
import { usePageStore } from "@/lib/store";
import { validateEmail } from "@/lib/security";
import { validatePassword } from "@/lib/validation";
import type { AdminUserPublic } from "@/lib/types";

// OWASP A07: keep login error generic (anti-enumeration). The server already
// returns identical messages for unknown emails and wrong passwords. We mirror
// that on the client so a passive observer can't infer which field failed.
const GENERIC_ERROR = "Invalid email or password.";

// Client-side rate limit (server has its own). 5 attempts per 60 seconds.
const MAX_ATTEMPTS = 5;
const WINDOW_MS = 60_000;

export function LoginForm() {
  const setIsAdmin = usePageStore((s) => s.setIsAdmin);
  const setAdminEmail = usePageStore((s) => s.setAdminEmail);

  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [submitting, setSubmitting] = React.useState(false);

  // Sliding-window attempt timestamps kept in a ref so they survive re-renders.
  const attemptsRef = React.useRef<number[]>([]);
  const [retryIn, setRetryIn] = React.useState(0);

  // Countdown ticker for the rate-limit lockout window.
  React.useEffect(() => {
    if (retryIn <= 0) return;
    const id = window.setInterval(() => {
      setRetryIn((prev) => Math.max(0, prev - 1));
    }, 1000);
    return () => window.clearInterval(id);
  }, [retryIn]);

  const showFieldError = (valid: boolean, _msg: string) => {
    // We deliberately show the same generic error for both fields to avoid
    // telling an attacker which one was wrong.
    if (!valid) {
      setError(GENERIC_ERROR);
      return false;
    }
    return true;
  };

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (submitting) return;

    // Apply client-side rate limit.
    const now = Date.now();
    attemptsRef.current = attemptsRef.current.filter(
      (t) => now - t < WINDOW_MS
    );
    if (attemptsRef.current.length >= MAX_ATTEMPTS) {
      const oldest = attemptsRef.current[0];
      const wait = Math.ceil((WINDOW_MS - (now - oldest)) / 1000);
      setRetryIn(wait);
      setError(`Too many attempts. Please wait ${wait}s before trying again.`);
      return;
    }

    // Validate locally. Both checks produce the same generic message so an
    // observer can't tell which field failed validation.
    // NOTE: use validatePassword (not validateText) so strong passwords that
    // happen to contain "<script" etc. are not rejected client-side (S2).
    const emailOk = validateEmail(email);
    const passOk = validatePassword(password, { minLen: 1, maxLen: 128 });
    if (!showFieldError(emailOk.valid, emailOk.error ?? "")) return;
    if (!showFieldError(passOk.valid, passOk.error ?? "")) return;

    setError(null);
    setSubmitting(true);
    attemptsRef.current.push(now);

    try {
      const { data, error: apiError } = await api.post<{
        user: AdminUserPublic;
      }>("/api/auth/login", { email, password });

      if (apiError || !data) {
        // Server returns 401 with the same generic message for both wrong
        // user and wrong password. Surface 429 (rate-limited) distinctly so the
        // user knows to wait; everything else collapses to GENERIC_ERROR.
        const msg =
          apiError && apiError.status === 429
            ? apiError.message
            : GENERIC_ERROR;
        setError(msg);
        if (apiError && apiError.status === 429) {
          setRetryIn(60);
        }
        return;
      }

      setIsAdmin(true);
      setAdminEmail(data.user.email);
      toast.success("Signed in", {
        description: `Welcome back, ${data.user.email}.`,
      });
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setSubmitting(false);
      // Clear the password from memory as soon as we're done with it.
      setPassword("");
    }
  }

  const locked = retryIn > 0;
  const disabled = submitting || locked;

  return (
    <div className="flex min-h-[50vh] items-center justify-center px-4 py-10 pb-32">
      <Card className="w-full max-w-md border-border/60 shadow-lg">
        <CardHeader className="items-center gap-3 text-center">
          {/* CardHeader is a grid; wrap logo in a full-width flex row to center it. */}
          <div className="flex w-full justify-center">
            <GearLogo size={56} />
          </div>
          <div className="space-y-1">
            <CardTitle className="font-display text-2xl">Admin Sign In</CardTitle>
            <CardDescription>
              Restricted area. Authorized administrators only.
            </CardDescription>
          </div>
        </CardHeader>

        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4" noValidate>
            <div className="space-y-2">
              <Label htmlFor="admin-email" className="text-xs uppercase tracking-wider">
                <Mail className="size-3.5" aria-hidden="true" />
                Email
              </Label>
              <Input
                id="admin-email"
                type="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                disabled={disabled}
                aria-required="true"
                aria-invalid={!!error}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="admin-password" className="text-xs uppercase tracking-wider">
                <Lock className="size-3.5" aria-hidden="true" />
                Password
              </Label>
              <Input
                id="admin-password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Your password"
                disabled={disabled}
                aria-required="true"
                aria-invalid={!!error}
              />
            </div>

            {error && (
              <Alert variant="destructive" role="alert">
                <ShieldAlert aria-hidden="true" />
                <AlertTitle>Sign-in failed</AlertTitle>
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}

            <Button
              type="submit"
              className="w-full"
              size="lg"
              disabled={disabled}
              aria-label="Sign in to admin panel"
            >
              {submitting ? (
                <>
                  <span
                    className="size-4 animate-spin rounded-full border-2 border-primary-foreground/30 border-t-primary-foreground"
                    aria-hidden="true"
                  />
                  Signing in...
                </>
              ) : locked ? (
                <>Please wait {retryIn}s</>
              ) : (
                <>
                  <LogIn aria-hidden="true" />
                  Sign In
                </>
              )}
            </Button>
          </form>

          <div className="mt-5">
            <p className="text-center text-[11px] text-muted-foreground">
              For security, failed attempts are rate-limited.
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
