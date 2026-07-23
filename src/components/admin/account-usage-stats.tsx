import { MessageSquare, MessagesSquare, Send, Target } from "lucide-react"
import type { AccountUsageStats } from "@/lib/admin/types"
import { StatTile } from "./stat-tile"

export function AccountUsageStatsRow({ stats }: { stats: AccountUsageStats }) {
  return (
    <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
      <StatTile
        label="Conversas"
        value={stats.conversations.toLocaleString("pt-BR")}
        icon={<MessagesSquare className="h-4 w-4" />}
      />
      <StatTile
        label="Mensagens"
        value={stats.messages.toLocaleString("pt-BR")}
        icon={<MessageSquare className="h-4 w-4" />}
      />
      <StatTile
        label="Disparos"
        value={stats.broadcasts.toLocaleString("pt-BR")}
        icon={<Send className="h-4 w-4" />}
      />
      <StatTile
        label="Negócios"
        value={stats.deals.toLocaleString("pt-BR")}
        icon={<Target className="h-4 w-4" />}
      />
    </div>
  )
}
