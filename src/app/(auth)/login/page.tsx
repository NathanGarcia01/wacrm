"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { createClient } from "@/lib/supabase/client";
import { ShieldCheck } from "lucide-react";
import { AuthShell } from "../_components/auth-shell";
import { GoogleIcon } from "../_components/google-icon";

// `useSearchParams` opts the component out of static prerendering
// unless it sits under a Suspense boundary. We split the form into
// a child component so the outer page can prerender the chrome
// (background, shell) while the form hydrates with the query
// string on the client.
export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginPageInner />
    </Suspense>
  );
}

function LoginPageInner() {
  const t = useTranslations("auth.login");
  const tShared = useTranslations("auth.shared");
  const searchParams = useSearchParams();
  // Forwarded from `/join/<token>` when the visitor already has an
  // account. After a successful sign-in we send them to the join
  // page to accept rather than to /dashboard.
  const inviteToken = searchParams.get("invite");

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const router = useRouter();
  const supabase = createClient();

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      setError(error.message);
      setLoading(false);
      return;
    }

    if (inviteToken) {
      router.push(`/join/${encodeURIComponent(inviteToken)}`);
    } else {
      router.push("/dashboard");
    }
  };

  return (
    <AuthShell>
      <div className="mb-8 flex flex-col gap-1.5">
        <h2 className="text-2xl font-semibold text-white">
          {inviteToken ? t("signInToAccept") : t("welcomeBack")}
        </h2>
        <p className="text-sm text-white/35">
          {inviteToken ? t("signInInviteHint") : t("signInHint")}
        </p>
      </div>

      <form onSubmit={handleLogin} className="flex flex-col gap-4">
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

        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <label
              htmlFor="password"
              className="text-[11px] font-medium tracking-wide text-white/30 uppercase"
            >
              {t("passwordLabel")}
            </label>
            <Link
              href="/forgot-password"
              className="text-xs text-[#5DCAA5] hover:text-[#1D9E75]"
            >
              {t("forgotPassword")}
            </Link>
          </div>
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

        <button
          type="submit"
          disabled={loading}
          className="mt-2 h-11 w-full rounded-lg bg-[#1D9E75] text-sm font-medium text-white transition-colors hover:bg-[#1D9E75]/90 disabled:opacity-50"
        >
          {loading ? t("signingIn") : t("signIn")}
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
        {t("noAccount")}{" "}
        <Link
          href={
            inviteToken
              ? `/signup?invite=${encodeURIComponent(inviteToken)}`
              : "/signup"
          }
          className="text-[#5DCAA5] hover:text-[#1D9E75]"
        >
          {t("createAccount")}
        </Link>
      </p>

      <div className="mt-10 flex items-center justify-center gap-2 text-xs text-white/20">
        <ShieldCheck className="h-3.5 w-3.5" />
        {tShared("secureConnection")}
      </div>
    </AuthShell>
  );
}
