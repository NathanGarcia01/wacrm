import type { Metadata } from "next";
import type { ReactNode } from "react";

// Chrome-free layout for the Embedded Signup number picker — this page
// only ever runs inside the small OAuth popup window, so it deliberately
// skips the (dashboard) group's sidebar/header/AccessGate/onboarding tour.
// Mirrors the (auth) route group's "minimal layout for a focused flow"
// pattern (src/app/(auth)/layout.tsx).
export const metadata: Metadata = {
  robots: {
    index: false,
    follow: false,
    nocache: true,
    googleBot: {
      index: false,
      follow: false,
      noimageindex: true,
    },
  },
};

export default function WhatsAppConnectLayout({ children }: { children: ReactNode }) {
  return children;
}
