"use client";

import { HelpCircle } from "lucide-react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import { useOnboardingTour } from "./onboarding-tour-provider";

/**
 * "Ver tour" — always available, for any role, at the bottom of the
 * sidebar. Unlike the auto-start on first login, this always restarts
 * from step 0 regardless of `profiles.onboarding_completed`.
 */
export function OnboardingTourButton({ collapsed }: { collapsed: boolean }) {
  const { startTour } = useOnboardingTour();
  const t = useTranslations("sidebar");

  return (
    <button
      type="button"
      onClick={startTour}
      aria-label={t("viewTour")}
      title={t("viewTour")}
      className={cn(
        "flex shrink-0 items-center gap-2 border-t border-border px-3 py-2.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground",
        collapsed && "justify-center",
      )}
    >
      <HelpCircle className="h-4 w-4" />
      {!collapsed && t("viewTour")}
    </button>
  );
}
