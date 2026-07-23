"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Lock } from "lucide-react"

export default function AdminLoginPage() {
  const router = useRouter()
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setLoading(true)
    try {
      const res = await fetch("/api/admin/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        setError(body.error ?? "Falha ao entrar")
        return
      }
      router.push("/admin")
      router.refresh()
    } catch {
      setError("Não foi possível conectar ao servidor")
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#0A0A0B] px-4">
      <div className="w-full max-w-sm rounded-xl border border-[#22242A] bg-[#141417] p-6">
        <div className="mb-5 flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-[#22242A] text-[#60A5FA]">
            <Lock className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-sm font-semibold text-white">Painel Admin</h1>
            <p className="text-xs text-white/50">Acesso restrito</p>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          {error && (
            <div className="rounded-lg border border-[#FB923C]/30 bg-[#FB923C]/10 px-3 py-2 text-xs text-[#FB923C]">
              {error}
            </div>
          )}
          <div className="flex flex-col gap-1.5">
            <label htmlFor="admin-email" className="text-xs font-medium text-white/60">
              Email
            </label>
            <input
              id="admin-email"
              type="email"
              autoFocus
              autoComplete="username"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              className="rounded-lg border border-[#22242A] bg-[#0A0A0B] px-3 py-2 text-sm text-white outline-none placeholder:text-white/30 focus:border-[#60A5FA]"
              placeholder="voce@funilly.tech"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="admin-password" className="text-xs font-medium text-white/60">
              Senha
            </label>
            <input
              id="admin-password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              className="rounded-lg border border-[#22242A] bg-[#0A0A0B] px-3 py-2 text-sm text-white outline-none placeholder:text-white/30 focus:border-[#60A5FA]"
              placeholder="••••••••"
            />
          </div>
          <button
            type="submit"
            disabled={loading}
            className="mt-2 h-9 rounded-lg bg-[#34D399] text-sm font-medium text-[#0A0A0B] transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {loading ? "Entrando…" : "Entrar"}
          </button>
        </form>
      </div>
    </div>
  )
}
