"use client";

import Link from "next/link";
import { Lock } from "lucide-react";
import { useTranslations } from "next-intl";

/**
 * Small pill linking to /billing/plans — the standard way a gated
 * feature tells the user why it's locked and where to fix that.
 * Used next to (not instead of) the disabled control, e.g. right of a
 * disabled "Criar com IA" button or a maxed-out "Adicionar número".
 */
export function UpgradeBadge() {
  const t = useTranslations("billing.upgradeBadge");
  return (
    <Link
      href="/billing/plans"
      className="inline-flex items-center gap-1 rounded-full border border-amber-500/30 bg-amber-500/10 px-2.5 py-1 text-xs font-medium text-amber-500 transition-colors hover:bg-amber-500/20"
    >
      <Lock className="size-3" />
      {t("label")}
    </Link>
  );
}
