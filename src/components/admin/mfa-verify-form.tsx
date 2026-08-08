"use client";

import * as React from "react";
import { ArrowLeft, KeyRound, RefreshCw, ShieldCheck } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  InputOTP,
  InputOTPGroup,
  InputOTPSlot,
} from "@/components/ui/input-otp";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { GearLogo } from "@/components/gear-logo";
import { api } from "@/lib/api-client";
import type { AdminUserPublic } from "@/lib/types";

const CODE_LENGTH = 6;
const RESEND_COOLDOWN_S = 30;

interface MfaVerifyFormProps {
  initialChallengeId: string;
  emailMasked: string;
  delivered: boolean;
  onBack: () => void;
  onSuccess: (user: AdminUserPublic) => void;
}

export function MfaVerifyForm({
  initialChallengeId,
  emailMasked,
  delivered,
  onBack,
  onSuccess,
}: MfaVerifyFormProps) {
  const [challengeId, setChallengeId] = React.useState(initialChallengeId);
  const [code, setCode] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [submitting, setSubmitting] = React.useState(false);
  const [resending, setResending] = React.useState(false);
  const [resendIn, setResendIn] = React.useState(RESEND_COOLDOWN_S);
  const [deliveryNote, setDeliveryNote] = React.useState<boolean>(delivered);

  React.useEffect(() => {
    if (resendIn <= 0) return;
    const id = window.setInterval(() => setResendIn((p) => Math.max(0, p - 1)), 1000);
    return () => window.clearInterval(id);
  }, [resendIn]);

  async function handleVerify(value: string) {
    const trimmed = value.replace(/\s+/g, "");
    if (trimmed.length !== CODE_LENGTH) {
      setError("Enter the 6-digit code.");
      return;
    }
    if (submitting) return;
    setError(null);
    setSubmitting(true);
    setCode(trimmed);

    const { data, error: apiError } = await api.post<{
      user: AdminUserPublic;
    }>("/api/auth/mfa/verify", { challengeId, code: trimmed });

    setSubmitting(false);

    if (apiError || !data) {
      if (apiError?.status === 429) {
        setError(apiError.message);
      } else {
        setError("Invalid or expired code. Try again or request a new code.");
        setCode("");
      }
      return;
    }
    onSuccess(data.user);
  }

  async function handleResend() {
    if (resending || resendIn > 0) return;
    setResending(true);
    setError(null);
    const { data, error: apiError } = await api.post<{
      challengeId: string;
      delivered: boolean;
    }>("/api/auth/mfa/resend", { challengeId });

    setResending(false);
    if (apiError || !data) {
      setError(apiError?.message ?? "Could not send a new code. Try again later.");
      return;
    }
    setChallengeId(data.challengeId);
    setDeliveryNote(data.delivered);
    setCode("");
    setResendIn(RESEND_COOLDOWN_S);
    toast.success("New code sent", {
      description: data.delivered
        ? "Check your email for the new code."
        : "Code generated. Contact your administrator if you did not receive it.",
    });
  }

  const disabled = submitting || resending;

  return (
    <div className="flex min-h-[50vh] items-center justify-center px-4 py-12 pb-32 sm:px-6">
      <Card className="w-full max-w-md border-border/60 shadow-lg">
        <CardHeader className="items-center gap-3 text-center">
          <div className="flex w-full justify-center">
            <GearLogo size={56} />
          </div>
          <div className="space-y-1">
            <CardTitle className="flex items-center justify-center gap-2 font-display text-2xl">
              <ShieldCheck className="size-5 text-primary" aria-hidden="true" />
              Verification Code
            </CardTitle>
            <CardDescription>
              Enter the 6-digit code sent to your admin email to complete sign-in.
            </CardDescription>
          </div>
        </CardHeader>

        <CardContent className="space-y-4">
          <div className="rounded-md border border-border/60 bg-muted/40 px-3 py-2 text-center text-xs text-muted-foreground">
            Code sent to <span className="font-medium text-foreground">{emailMasked}</span>
          </div>

          {!deliveryNote && (
            <Alert>
              <KeyRound aria-hidden="true" />
              <AlertTitle>Email delivery unavailable</AlertTitle>
              <AlertDescription>
                SMTP is not configured. The code was logged on the server — ask your
                administrator to retrieve it, or configure SMTP to receive it by email.
              </AlertDescription>
            </Alert>
          )}

          <div className="flex flex-col items-center gap-3">
            <InputOTP
              maxLength={CODE_LENGTH}
              value={code}
              onChange={(v) => {
                setCode(v);
                if (error) setError(null);
              }}
              onComplete={(v) => void handleVerify(v)}
              disabled={disabled}
              aria-label="6-digit verification code"
            >
              <InputOTPGroup>
                <InputOTPSlot index={0} />
                <InputOTPSlot index={1} />
                <InputOTPSlot index={2} />
              </InputOTPGroup>
              <InputOTPGroup>
                <InputOTPSlot index={3} />
                <InputOTPSlot index={4} />
                <InputOTPSlot index={5} />
              </InputOTPGroup>
            </InputOTP>
          </div>

          {error && (
            <Alert variant="destructive" role="alert">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          <Button
            type="button"
            className="w-full"
            size="lg"
            disabled={disabled || code.length !== CODE_LENGTH}
            onClick={() => void handleVerify(code)}
            aria-label="Verify code"
          >
            {submitting ? (
              <>
                <span
                  className="size-4 animate-spin rounded-full border-2 border-primary-foreground/30 border-t-primary-foreground"
                  aria-hidden="true"
                />
                Verifying...
              </>
            ) : (
              <>
                <ShieldCheck aria-hidden="true" />
                Verify &amp; Sign In
              </>
            )}
          </Button>

          <div className="flex items-center justify-between text-xs">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={onBack}
              disabled={disabled}
              className="text-muted-foreground"
            >
              <ArrowLeft className="size-3.5" aria-hidden="true" />
              Back
            </Button>
            <Button
              type="button"
              variant="link"
              size="sm"
              onClick={() => void handleResend()}
              disabled={disabled || resendIn > 0}
              className="h-8 px-2"
            >
              <RefreshCw className="size-3.5" aria-hidden="true" />
              {resendIn > 0 ? `Resend in ${resendIn}s` : "Resend code"}
            </Button>
          </div>

          <p className="text-center text-[11px] text-muted-foreground">
            For security, codes expire after 5 minutes and allow limited attempts.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
