"use client";

import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { toast } from "sonner";
import type { Contact, Conversation, Message } from "@/types";
import { MessageThread } from "@/components/inbox/message-thread";
import { Button } from "@/components/ui/button";
import { Loader2, MessageSquarePlus, Smartphone } from "lucide-react";

/**
 * Fase 6 (negócio com conversa embutida), Etapa 2 — reaproveita
 * MessageThread (que já embute MessageComposer) 100% como está: zero
 * componente paralelo. MessageThread já é autocontido pra tudo que
 * importa aqui — janela de 24h, templates, ações de ticket, mídia —
 * confirmado no diagnóstico. O único ponto real de acoplamento era a
 * busca inicial de mensagens + realtime de novas mensagens, que a
 * página da inbox fazia por fora; aqui replicamos isso sozinhos,
 * escopado só a esta conversa.
 *
 * Decisão 1 — sem seletor de canal: o próprio MessageThread já tem um
 * picker clicável, mas só aparece com mais de um canal ativo na
 * conta. Aqui, independente disso, mostramos sempre um badge simples
 * (não clicável) com o canal atual da conversa.
 */
export function DealConversationTab({ contact }: { contact: Contact | null }) {
  const supabase = createClient();
  const { accountId, user } = useAuth();
  const t = useTranslations("pipelines.dealDetail");

  const [loading, setLoading] = useState(true);
  const [conversation, setConversation] = useState<Conversation | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [resyncToken, setResyncToken] = useState(0);
  const [starting, setStarting] = useState(false);

  // No máximo uma conversa por contato (ver diagnóstico da Fase 6) —
  // mesma query que deal-form.tsx já usa pro link "Abrir conversa".
  const loadConversation = useCallback(async () => {
    if (!contact?.id) {
      setConversation(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    const { data } = await supabase
      .from("conversations")
      .select("*, channel:whatsapp_channels(name, display_phone_number, channel_type)")
      .eq("contact_id", contact.id)
      .order("last_message_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    setConversation((data as Conversation | null) ?? null);
    setLoading(false);
  }, [contact, supabase]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadConversation();
  }, [loadConversation]);

  // Realtime só desta conversa — MessageThread busca o lote inicial
  // sozinho (via onMessagesLoaded) mas nunca assina a tabela
  // `messages`; na inbox isso é feito pela página, aqui replicamos
  // escopado a uma única conversa. Mesmo padrão do canal de
  // message_reactions que o próprio message-thread.tsx já usa
  // internamente (linha ~498-566), só que para `messages`.
  useEffect(() => {
    if (!conversation?.id) return;
    const channel = supabase
      .channel(`deal-panel-messages:${conversation.id}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "messages", filter: `conversation_id=eq.${conversation.id}` },
        (payload) => {
          const row = payload.new as Message;
          setMessages((prev) => (prev.some((m) => m.id === row.id) ? prev : [...prev, row]));
        },
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "messages", filter: `conversation_id=eq.${conversation.id}` },
        (payload) => {
          const row = payload.new as Message;
          setMessages((prev) => prev.map((m) => (m.id === row.id ? row : m)));
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [conversation?.id, supabase]);

  async function handleStartConversation() {
    if (!contact?.id || !accountId || !user?.id) return;
    setStarting(true);
    const { data, error } = await supabase
      .from("conversations")
      .insert({ account_id: accountId, user_id: user.id, contact_id: contact.id, status: "open" })
      .select("*, channel:whatsapp_channels(name, display_phone_number, channel_type)")
      .single();
    setStarting(false);
    if (error || !data) {
      toast.error(t("startConversationFailed"));
      return;
    }
    setConversation(data as Conversation);
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!contact) {
    return <p className="text-sm text-muted-foreground">{t("noContact")}</p>;
  }

  if (!conversation) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-12 text-center">
        <p className="text-sm text-muted-foreground">{t("noConversationYet")}</p>
        <Button onClick={handleStartConversation} disabled={starting} className="bg-primary text-primary-foreground hover:bg-primary/90">
          {starting ? <Loader2 className="h-4 w-4 animate-spin" /> : <MessageSquarePlus className="h-4 w-4" />}
          {t("startConversation")}
        </Button>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      {conversation.channel && (
        <div className="flex shrink-0 items-center gap-1.5 border-b border-border/50 px-3 py-1.5 text-[11px] text-muted-foreground">
          <Smartphone className="h-3 w-3" />
          {t("channelBadge", {
            name: conversation.channel.display_phone_number || conversation.channel.name,
          })}
        </div>
      )}
      <div className="min-h-0 flex-1">
        <MessageThread
          conversation={conversation}
          contact={contact}
          messages={messages}
          onMessagesLoaded={setMessages}
          onNewMessage={(m) => setMessages((prev) => [...prev, m])}
          onUpdateMessage={(id, updates) =>
            setMessages((prev) => prev.map((m) => (m.id === id ? { ...m, ...updates } : m)))
          }
          onStatusChange={(_, status) => setConversation((prev) => (prev ? { ...prev, status } : prev))}
          onAssignChange={(_, assignedAgentId) =>
            setConversation((prev) => (prev ? { ...prev, assigned_agent_id: assignedAgentId ?? undefined } : prev))
          }
          onChannelChange={(_, channelId, channel) =>
            setConversation((prev) =>
              prev ? { ...prev, channel_id: channelId, channel: { ...channel, channel_type: prev.channel?.channel_type } } : prev,
            )
          }
          onUnreadChange={(_, unreadCount) =>
            setConversation((prev) => (prev ? { ...prev, unread_count: unreadCount } : prev))
          }
          resyncToken={resyncToken}
          onRefresh={() => setResyncToken((n) => n + 1)}
        />
      </div>
    </div>
  );
}
