"use client"

import { useState } from "react"
import { ExternalLink, Loader2, ShieldAlert } from "lucide-react"

export function ImpersonateButton({ accountId }: { accountId: string }) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [confirmOpen, setConfirmOpen] = useState(false)

  async function handleImpersonate() {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/admin/accounts/${accountId}/impersonate`, { method: "POST" })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(body.error ?? "Falha ao gerar link")
        return
      }
      window.open(body.actionLink as string, "_blank", "noopener,noreferrer")
      setConfirmOpen(false)
    } catch {
      setError("Não foi possível conectar ao servidor")
    } finally {
      setLoading(false)
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setConfirmOpen(true)}
        className="inline-flex items-center gap-1.5 rounded-lg border border-[#22242A] px-3 py-1.5 text-xs font-medium text-white/70 hover:border-white/20 hover:text-white"
      >
        <ExternalLink className="h-3.5 w-3.5" />
        Acessar como este cliente
      </button>

      {confirmOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4">
          <div className="w-full max-w-sm rounded-xl border border-[#22242A] bg-[#141417] p-5">
            <h2 className="flex items-center gap-2 text-sm font-semibold text-white">
              <ShieldAlert className="h-4 w-4 text-[#FB923C]" />
              Acessar como este cliente
            </h2>
            <p className="mt-3 text-sm text-white/70">
              Isso abre um link mágico que troca a sessão da aba/navegador atual pela do cliente.
              Use uma janela anônima para não perder sua própria sessão de admin.
            </p>
            {error && (
              <div className="mt-3 rounded-lg border border-[#FB923C]/30 bg-[#FB923C]/10 px-3 py-2 text-xs text-[#FB923C]">
                {error}
              </div>
            )}
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirmOpen(false)}
                className="rounded-lg border border-[#22242A] px-3 py-1.5 text-xs font-medium text-white/60 hover:border-white/20 hover:text-white"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleImpersonate}
                disabled={loading}
                className="inline-flex items-center gap-1.5 rounded-lg bg-[#34D399] px-3 py-1.5 text-xs font-medium text-[#0A0A0B] disabled:opacity-50"
              >
                {loading && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                Gerar link e abrir
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
