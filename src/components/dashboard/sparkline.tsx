"use client"

/** Minimal inline trend line — no axes/tooltip/legend, just a shape
 *  behind a KPI card's delta row. Plain SVG (no recharts) since it's
 *  a handful of points and doesn't need interactivity. */
export function Sparkline({
  values,
  tone = "default",
  className,
}: {
  values: number[]
  tone?: "default" | "good" | "bad"
  className?: string
}) {
  const clean = values.filter((v) => Number.isFinite(v))
  if (clean.length < 2) return null

  const width = 100
  const height = 28
  const min = Math.min(...clean)
  const max = Math.max(...clean)
  const range = max - min || 1

  const points = values.map((v, i) => {
    const x = (i / (values.length - 1)) * width
    const y = Number.isFinite(v) ? height - ((v - min) / range) * height : height / 2
    return `${x},${y}`
  })

  const strokeClass =
    tone === "good" ? "stroke-primary" : tone === "bad" ? "stroke-destructive" : "stroke-muted-foreground"

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      className={className}
      width="100%"
      height={height}
      aria-hidden
    >
      <polyline
        points={points.join(" ")}
        fill="none"
        className={strokeClass}
        strokeWidth={1.75}
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity={0.8}
      />
    </svg>
  )
}
