import type { Metadata } from "next";

// Public marketing site — no auth, no dashboard chrome. Sibling route
// group to (dashboard)/(auth), so it naturally gets neither of those
// layouts (Next.js route groups don't nest unless the folder does).
//
// Overrides the root layout's `robots: { index: false }` — that
// default makes sense for the authenticated app (nothing behind
// /dashboard should be crawlable), but this is the actual sales site
// and needs to be indexable.
export const metadata: Metadata = {
  robots: {
    index: true,
    follow: true,
  },
};

export default function MarketingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-[#060810] font-sans text-white">
      {children}
    </div>
  );
}
