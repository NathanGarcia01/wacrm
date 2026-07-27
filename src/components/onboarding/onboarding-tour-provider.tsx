"use client";

import { createContext, useCallback, useContext, useEffect, useRef, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { driver, type Driver } from "driver.js";
import "driver.js/dist/driver.css";
import { createClient } from "@/lib/supabase/client";
import { TOUR_STEPS } from "@/lib/onboarding/tour-steps";

interface OnboardingTourContextValue {
  /** Always starts from step 0, destroying any tour already in progress
   *  first — this is both the auto-start entry point and what the
   *  sidebar's "Ver tour" button calls to replay it on demand. */
  startTour: () => void;
}

const OnboardingTourContext = createContext<OnboardingTourContextValue | null>(null);

export function useOnboardingTour(): OnboardingTourContextValue {
  const ctx = useContext(OnboardingTourContext);
  if (!ctx) {
    throw new Error("useOnboardingTour must be used within an OnboardingTourProvider");
  }
  return ctx;
}

/**
 * Drives a single driver.js instance across every screen the tour
 * touches. Steps live in one flat array (TOUR_STEPS) spanning 8 routes —
 * rather than one driver.js instance per page, this uses ONE instance
 * for the whole tour and does the cross-page navigation itself inside
 * onNextClick/onPrevClick (driver.js has no concept of SPA routing).
 *
 * That works because of two driver.js config options doing real work
 * here: `waitForElement` makes it retry (via a MutationObserver) for a
 * few seconds after we call router.push(), which is exactly how long a
 * client-side navigation + data fetch takes to mount the next step's
 * target; `skipMissingElement` makes a step that never appears (e.g. an
 * empty Contacts table for a brand-new account — this tour runs on
 * first login, before the user has created anything) silently skip
 * instead of hanging or crashing.
 */
export function OnboardingTourProvider({
  userId,
  onboardingCompleted,
  children,
}: {
  /** Null while the session/profile is still loading — auto-start
   *  waits for a real id before writing anything. */
  userId: string | null;
  /** `profile.onboarding_completed`. Null while the profile is still
   *  loading — auto-start only fires once this resolves to `false`,
   *  never while it's null (which would fire on every reload before
   *  the profile settles) or true. */
  onboardingCompleted: boolean | null;
  children: ReactNode;
}) {
  const router = useRouter();
  const t = useTranslations("onboarding.tour");
  const driverRef = useRef<Driver | null>(null);
  const userIdRef = useRef(userId);
  useEffect(() => {
    userIdRef.current = userId;
  }, [userId]);
  // Guards onDestroyed's write against the one destroy() call that
  // does NOT mean "the user finished or skipped the tour" — the
  // unmount-cleanup effect below, which tears down the instance for
  // unrelated reasons (sign-out, hot reload) and must not silently
  // mark onboarding as done just because the shell went away mid-tour.
  const skipCompletionOnDestroyRef = useRef(false);

  const markCompleted = useCallback(async () => {
    const uid = userIdRef.current;
    if (!uid) return;
    const supabase = createClient();
    const { error } = await supabase
      .from("profiles")
      .update({ onboarding_completed: true })
      .eq("user_id", uid);
    if (error) {
      console.error("[OnboardingTourProvider] failed to mark onboarding_completed:", error);
    }
  }, []);

  // Only pushes when we're not already there — most consecutive steps
  // share a route, and re-pushing the current URL is wasted work (and
  // an extra history entry) for no benefit.
  const navigateToRoute = useCallback(
    (route: string) => {
      const current = window.location.pathname + window.location.search;
      if (current !== route) {
        router.push(route);
      }
    },
    [router],
  );

  const startTour = useCallback(() => {
    // "Ver tour" always restarts from the top, even mid-tour — tear down
    // whatever's active first rather than layering a second instance.
    driverRef.current?.destroy();

    const steps = TOUR_STEPS.map((step) => ({
      element: step.selector ?? undefined,
      popover: {
        title: t(step.titleKey),
        description: t(step.descriptionKey),
      },
    }));

    const instance = driver({
      steps,
      showProgress: true,
      progressText: t("progressText"),
      nextBtnText: t("next"),
      prevBtnText: t("previous"),
      doneBtnText: t("done"),
      allowClose: true,
      overlayOpacity: 0.7,
      // See the file-level doc comment — these two are what make a
      // single instance work across 8 different routes.
      skipMissingElement: true,
      waitForElement: 4000,
      onNextClick: (_element, _step, opts) => {
        const currentIndex = opts.index ?? 0;
        const next = TOUR_STEPS[currentIndex + 1];
        if (next) navigateToRoute(next.route);
        // On the last step this falls through to driver.js's own
        // "no next step → destroy" behavior, which still fires
        // onDestroyed below — no separate onDoneClick needed.
        opts.driver.moveNext();
      },
      onPrevClick: (_element, _step, opts) => {
        const currentIndex = opts.index ?? 0;
        const prev = TOUR_STEPS[currentIndex - 1];
        if (prev) navigateToRoute(prev.route);
        opts.driver.movePrevious();
      },
      // driver.js only ships Next/Previous/Close buttons — the product
      // spec wants an explicit "Pular tour" affordance distinct from the
      // corner close (×), so inject one into the popover footer on every
      // render (onPopoverRender fires with a freshly-built footer each
      // time, so there's no accumulation to guard against).
      onPopoverRender: (popoverDom) => {
        const skipButton = document.createElement("button");
        skipButton.type = "button";
        skipButton.className = "driver-popover-footer-btn onboarding-tour-skip-btn";
        skipButton.textContent = t("skip");
        skipButton.addEventListener("click", () => driverRef.current?.destroy());
        // Inserted as a 3rd flex child in the footer (progress text —
        // skip — prev/next), not inside footerButtons alongside
        // Previous/Next, so it reads as its own affordance rather than
        // another navigation step.
        popoverDom.footer.insertBefore(skipButton, popoverDom.footerButtons);
      },
      // Fires on every path out of the tour — Done on the last step,
      // the × close button, Escape, or an overlay click — so this is
      // the one place that needs to persist completion, rather than
      // duplicating the write across each of those handlers.
      onDestroyed: () => {
        if (!skipCompletionOnDestroyRef.current) {
          markCompleted();
        }
        driverRef.current = null;
      },
    });

    driverRef.current = instance;
    navigateToRoute(TOUR_STEPS[0].route);
    instance.drive(0);
  }, [t, navigateToRoute, markCompleted]);

  // Fires once, the first time the profile resolves with
  // onboarding_completed === false. The ref guards against re-firing if
  // this flips again later in the session (e.g. right after the tour
  // itself writes `true` back, or a manual replay via "Ver tour").
  const autoStartedRef = useRef(false);
  useEffect(() => {
    if (autoStartedRef.current) return;
    if (onboardingCompleted === false) {
      autoStartedRef.current = true;
      startTour();
    }
  }, [onboardingCompleted, startTour]);

  useEffect(() => {
    return () => {
      // Unmounting the whole shell (sign-out, etc.) — don't leave a
      // detached driver.js overlay listening on the window, but don't
      // count it as the user finishing the tour either.
      skipCompletionOnDestroyRef.current = true;
      driverRef.current?.destroy();
    };
  }, []);

  return (
    <OnboardingTourContext.Provider value={{ startTour }}>
      {children}
    </OnboardingTourContext.Provider>
  );
}
