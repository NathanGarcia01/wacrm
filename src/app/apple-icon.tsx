import { ImageResponse } from "next/og";

// Apple touch icon — same Funilly brand mark as `public/logo-icon.svg`
// (green square + white message-bubble glyph), sized for iOS
// home-screen shortcuts. iOS applies its own corner mask, so this
// stays a flat square with no border-radius. Next.js renders this at
// build time and auto-injects <link rel="apple-touch-icon"> into
// <head>. Kept as a separate PNG render (rather than pointing at the
// SVG directly) because iOS doesn't reliably accept SVG for
// apple-touch-icon.
//
// The inner shapes are the same bubble-rect + tail-path geometry as
// public/logo-icon.svg's 64x64 viewBox, just reused at a different
// render size — see that file if the mark itself ever changes.

export const runtime = "edge";
export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#1D9E75",
        }}
      >
        <svg width="130" height="130" viewBox="0 0 64 64" fill="none">
          <rect x="16" y="17" width="32" height="22" rx="5" fill="#FFFFFF" />
          <path d="M24 39H32L22 48Z" fill="#FFFFFF" />
        </svg>
      </div>
    ),
    { ...size },
  );
}
