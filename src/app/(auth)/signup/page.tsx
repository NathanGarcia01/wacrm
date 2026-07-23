"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { createClient } from "@/lib/supabase/client";
import { CheckCircle, ShieldCheck } from "lucide-react";
import { AuthShell } from "../_components/auth-shell";
import { GoogleIcon } from "../_components/google-icon";

// `useSearchParams` opts the component out of static prerendering
// unless wrapped in Suspense — same pattern as /login.
export default function SignupPage() {
  return (
    <Suspense fallback={null}>
      <SignupPageInner />
    </Suspense>
  );
}

function SignupPageInner() {
  const t = useTranslations("auth.signup");
  const tShared = useTranslations("auth.shared");
  const searchParams = useSearchParams();
  // When the user lands here from `/join/<token>` we carry the
  // invite token in the query so it survives the signup → email
  // verification → redirect round-trip. `emailRedirectTo` below
  // points back at /join/<token> so the user lands on the redeem
  // step after verifying instead of being dropped on /dashboard.
  const inviteToken = searchParams.get("invite");

  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const supabase = createClient();

  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (password !== confirmPassword) {
      setError(t("passwordsDontMatch"));
      return;
    }

    if (password.length < 6) {
      setError(t("passwordTooShort"));
      return;
    }

    setLoading(true);

    // If we have an invite token, point Supabase's verification
    // email back at the join page so the user can accept after
    // verifying. Without a token, Supabase uses its default
    // redirect (the app root).
    const emailRedirectTo = inviteToken
      ? `${window.location.origin}/join/${encodeURIComponent(inviteToken)}`
      : undefined;

    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: {
          full_name: fullName,
        },
        ...(emailRedirectTo ? { emailRedirectTo } : {}),
      },
    });

    if (error) {
      setError(error.message);
      setLoading(false);
      return;
    }

    // Fire-and-forget — the welcome email must never block or fail
    // the signup flow. The route looks up the email/name itself from
    // the user id, so nothing sensitive is sent from the client.
    if (data.user) {
      fetch("/api/auth/welcome-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: data.user.id }),
      }).catch(() => {
        // Best-effort; a network hiccup here shouldn't surface to the user.
      });
    }

    setSuccess(true);
    setLoading(false);
  };

  if (success) {
    return (
      <AuthShell>
        <div className="flex flex-col items-center gap-4 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-[#1D9E75]/10">
            <CheckCircle className="h-6 w-6 text-[#1D9E75]" />
          </div>
          <div className="flex flex-col gap-1.5">
            <h2 className="text-2xl font-semibold text-white">
              {t("checkYourEmail")}
            </h2>
            <p className="text-sm text-white/35">
              {t("confirmationSentPrefix")}{" "}
              <span className="text-white">{email}</span>.{" "}
              {t("confirmationSentSuffix")}
            </p>
          </div>
          <Link
            href={
              inviteToken
                ? `/login?invite=${encodeURIComponent(inviteToken)}`
                : "/login"
            }
            className="mt-2 flex h-11 w-full items-center justify-center rounded-lg border border-white/8 text-sm font-medium text-white/70 transition-colors hover:bg-white/4"
          >
            {t("backToSignIn")}
          </Link>
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell>
      <div className="mb-8 flex flex-col gap-1.5">
        <h2 className="text-2xl font-semibold text-white">
          {inviteToken ? t("createAccountAndJoin") : t("createAccount")}
        </h2>
        <p className="text-sm text-white/35">
          {inviteToken ? t("verifyThenAcceptHint") : t("getStartedHint")}
        </p>
      </div>

      <form onSubmit={handleSignup} className="flex flex-col gap-4">
        {error && (
          <div className="rounded-lg border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-400">
            {error}
          </div>
        )}

        <div className="flex flex-col gap-2">
          <label
            htmlFor="fullName"
            className="text-[11px] font-medium tracking-wide text-white/30 uppercase"
          >
            {t("fullNameLabel")}
          </label>
          <input
            id="fullName"
            type="text"
            placeholder="João da Silva"
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            required
            className="h-11 rounded-lg border border-white/8 bg-white/4 px-3.5 text-sm text-white outline-none transition-colors placeholder:text-white/20 focus:border-[#1D9E75] focus:ring-2 focus:ring-[#1D9E75]/20"
          />
        </div>

        <div className="flex flex-col gap-2">
          <label
            htmlFor="email"
            className="text-[11px] font-medium tracking-wide text-white/30 uppercase"
          >
            {t("emailLabel")}
          </label>
          <input
            id="email"
            type="email"
            placeholder="voce@empresa.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            className="h-11 rounded-lg border border-white/8 bg-white/4 px-3.5 text-sm text-white outline-none transition-colors placeholder:text-white/20 focus:border-[#1D9E75] focus:ring-2 focus:ring-[#1D9E75]/20"
          />
        </div>

        <div className="flex flex-col gap-2">
          <label
            htmlFor="password"
            className="text-[11px] font-medium tracking-wide text-white/30 uppercase"
          >
            {t("passwordLabel")}
          </label>
          <input
            id="password"
            type="password"
            placeholder={t("passwordPlaceholder")}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            className="h-11 rounded-lg border border-white/8 bg-white/4 px-3.5 text-sm text-white outline-none transition-colors placeholder:text-white/20 focus:border-[#1D9E75] focus:ring-2 focus:ring-[#1D9E75]/20"
          />
        </div>

        <div className="flex flex-col gap-2">
          <label
            htmlFor="confirmPassword"
            className="text-[11px] font-medium tracking-wide text-white/30 uppercase"
          >
            {t("confirmPasswordLabel")}
          </label>
          <input
            id="confirmPassword"
            type="password"
            placeholder={t("confirmPasswordPlaceholder")}
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            required
            className="h-11 rounded-lg border border-white/8 bg-white/4 px-3.5 text-sm text-white outline-none transition-colors placeholder:text-white/20 focus:border-[#1D9E75] focus:ring-2 focus:ring-[#1D9E75]/20"
          />
        </div>

        <button
          type="submit"
          disabled={loading}
          className="mt-2 h-11 w-full rounded-lg bg-[#1D9E75] text-sm font-medium text-white transition-colors hover:bg-[#1D9E75]/90 disabled:opacity-50"
        >
          {loading ? t("creatingAccount") : t("createAccount")}
        </button>
      </form>

      <div className="my-6 flex items-center gap-3">
        <div className="h-px flex-1 bg-white/8" />
        <span className="text-xs text-white/20">
          {tShared("orContinueWith")}
        </span>
        <div className="h-px flex-1 bg-white/8" />
      </div>

      <button
        type="button"
        className="flex h-11 w-full items-center justify-center gap-2 rounded-lg border border-white/8 text-sm font-medium text-white/70 transition-colors hover:bg-white/4"
      >
        <GoogleIcon className="h-4 w-4" />
        {tShared("continueWithGoogle")}
      </button>

      <p className="mt-6 text-center text-sm text-white/35">
        {t("alreadyHaveAccount")}{" "}
        <Link
          href={
            inviteToken
              ? `/login?invite=${encodeURIComponent(inviteToken)}`
              : "/login"
          }
          className="text-[#5DCAA5] hover:text-[#1D9E75]"
        >
          {t("signIn")}
        </Link>
      </p>

      <div className="mt-10 flex items-center justify-center gap-2 text-xs text-white/20">
        <ShieldCheck className="h-3.5 w-3.5" />
        {tShared("secureConnection")}
      </div>
    </AuthShell>
  );
}
