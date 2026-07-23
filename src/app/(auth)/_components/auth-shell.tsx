import type { ReactNode } from "react";
import { AuthBrandPanel } from "./auth-brand-panel";

export function AuthShell({ children }: { children: ReactNode }) {
  return (
    <div className="grid min-h-screen bg-[#0D1117] lg:grid-cols-2">
      <AuthBrandPanel />
      <div className="flex min-h-screen items-center justify-center px-6 py-12 lg:border-l lg:border-white/6">
        <div className="w-full max-w-[320px]">{children}</div>
      </div>
    </div>
  );
}
