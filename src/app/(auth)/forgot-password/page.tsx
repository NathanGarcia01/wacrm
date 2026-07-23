"use client";

import { useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { createClient } from "@/lib/supabase/client";
import { ArrowLeft, CheckCircle } from "lucide-react";
import { AuthShell } from "../_components/auth-shell";

export default function ForgotPasswordPage() {
  const t = useTranslations("auth.forgotPassword");
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const supabase = createClient();

  const handleReset = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/auth/callback?next=/reset-password`,
    });

    if (error) {
      setError(error.message);
      setLoading(false);
      return;
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
              {t("resetLinkSentPrefix")}{" "}
              <span className="text-white">{email}</span>.{" "}
              {t("resetLinkSentSuffix")}
            </p>
          </div>
          <Link
            href="/login"
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
          {t("resetPassword")}
        </h2>
        <p className="text-sm text-white/35">{t("resetHint")}</p>
      </div>

      <form onSubmit={handleReset} className="flex flex-col gap-4">
        {error && (
          <div className="rounded-lg border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-400">
            {error}
          </div>
        )}

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

        <button
          type="submit"
          disabled={loading}
          className="mt-2 h-11 w-full rounded-lg bg-[#1D9E75] text-sm font-medium text-white transition-colors hover:bg-[#1D9E75]/90 disabled:opacity-50"
        >
          {loading ? t("sending") : t("sendResetLink")}
        </button>
      </form>

      <Link
        href="/login"
        className="mt-6 flex items-center justify-center gap-2 text-sm text-white/35 hover:text-white"
      >
        <ArrowLeft className="h-4 w-4" />
        {t("backToSignIn")}
      </Link>
    </AuthShell>
  );
}
