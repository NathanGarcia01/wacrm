"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Camera, Loader2, Check, X } from "lucide-react"

type Status = "idle" | "loading" | "success" | "error"

export function SnapshotButton() {
  const router = useRouter()
  const [status, setStatus] = useState<Status>("idle")

  async function handleClick() {
    setStatus("loading")
    try {
      const res = await fetch("/api/admin/mrr-snapshot", { method: "POST" })
      if (!res.ok) {
        setStatus("error")
        return
      }
      setStatus("success")
      router.refresh()
    } catch {
      setStatus("error")
    } finally {
      setTimeout(() => setStatus("idle"), 2000)
    }
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={status === "loading"}
      className="inline-flex items-center gap-1.5 rounded-lg border border-[#22242A] px-3 py-1.5 text-xs font-medium text-white/60 transition-colors hover:border-white/20 hover:text-white disabled:opacity-50"
      title="Modo de teste — captura um snapshot de MRR sob demanda"
    >
      {status === "loading" ? (
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
      ) : status === "success" ? (
        <Check className="h-3.5 w-3.5 text-[#34D399]" />
      ) : status === "error" ? (
        <X className="h-3.5 w-3.5 text-[#FB923C]" />
      ) : (
        <Camera className="h-3.5 w-3.5" />
      )}
      Capturar snapshot
      <span className="rounded-full bg-[#22242A] px-1.5 py-0.5 text-[10px] text-white/50">
        modo de teste
      </span>
    </button>
  )
}
