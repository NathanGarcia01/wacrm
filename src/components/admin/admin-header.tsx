"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { LogOut } from "lucide-react"
import type { AdminRole } from "@/lib/admin/types"
import { SnapshotButton } from "./snapshot-button"

export function AdminHeader({ admin }: { admin?: { name: string; email: string; role: AdminRole } }) {
  const router = useRouter()
  const [loggingOut, setLoggingOut] = useState(false)

  async function handleLogout() {
    setLoggingOut(true)
    try {
      await fetch("/api/admin/logout", { method: "POST" })
    } finally {
      router.push("/admin/login")
      router.refresh()
    }
  }

  return (
    <header className="flex flex-wrap items-center justify-between gap-3 border-b border-[#22242A] px-6 py-4">
      <div>
        <h1 className="text-sm font-semibold text-white">Painel Admin</h1>
        <p className="text-xs text-white/40">Billing, contas e MRR</p>
      </div>
      <div className="flex items-center gap-3">
        {admin && (
          <div className="hidden text-right sm:block">
            <p className="text-xs font-medium text-white/80">{admin.name}</p>
            <p className="text-[10px] text-white/40">
              {admin.email} ·{" "}
              <span className={admin.role === "owner" ? "text-[#34D399]" : "text-white/40"}>
                {admin.role === "owner" ? "owner" : "viewer"}
              </span>
            </p>
          </div>
        )}
        <SnapshotButton />
        <button
          type="button"
          onClick={handleLogout}
          disabled={loggingOut}
          className="inline-flex items-center gap-1.5 rounded-lg border border-[#22242A] px-3 py-1.5 text-xs font-medium text-white/60 transition-colors hover:border-white/20 hover:text-white disabled:opacity-50"
        >
          <LogOut className="h-3.5 w-3.5" />
          Sair
        </button>
      </div>
    </header>
  )
}
