"use client";

import { useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { createClient } from "@/lib/supabase/client";
import { CheckCircle } from "lucide-react";
import { AuthShell } from "../_components/auth-shell";

export default function ResetPasswordPage() {
  const t = useTranslations("auth.resetPassword");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const supabase = createClient();

  const handleReset = async (e: React.FormEvent) => {
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

    const { error } = await supabase.auth.updateUser({ password });

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
              {t("successTitle")}
            </h2>
            <p className="text-sm text-white/35">{t("successMessage")}</p>
          </div>
          <Link
            href="/login"
            className="mt-2 flex h-11 w-full items-center justify-center rounded-lg bg-[#1D9E75] text-sm font-medium text-white transition-colors hover:bg-[#1D9E75]/90"
          >
            {t("goToLogin")}
          </Link>
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell>
      <div className="mb-8 flex flex-col gap-1.5">
        <h2 className="text-2xl font-semibold text-white">{t("title")}</h2>
        <p className="text-sm text-white/35">{t("hint")}</p>
      </div>

      <form onSubmit={handleReset} className="flex flex-col gap-4">
        {error && (
          <div className="rounded-lg border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-400">
            {error}
          </div>
        )}

        <div className="flex flex-col gap-2">
          <label
            htmlFor="password"
            className="text-[11px] font-medium tracking-wide text-white/30 uppercase"
          >
            {t("newPasswordLabel")}
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
          {loading ? t("updating") : t("updateButton")}
        </button>
      </form>
    </AuthShell>
  );
}
