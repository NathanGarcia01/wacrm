"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { createClient } from "@/lib/supabase/client";
import type { Contact, Message } from "@/types";
import { File, FileAudio, FileText, Loader2 } from "lucide-react";

const MEDIA_CONTENT_TYPES = ["image", "video", "audio", "document"] as const;

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * Fase 6, decisão 5 — "por enquanto só listar a mídia da conversa",
 * sem upload próprio. Mesma busca de conversa de deal-conversation-
 * tab.tsx (no máximo uma por contato) — repetida aqui em vez de
 * compartilhada via prop porque esta aba pode ser aberta sem a de
 * Conversa ter sido montada ainda.
 */
export function DealFilesTab({ contact }: { contact: Contact | null }) {
  const t = useTranslations("pipelines.dealDetail");
  const supabase = createClient();

  const [loading, setLoading] = useState(true);
  const [messages, setMessages] = useState<Message[]>([]);

  useEffect(() => {
    if (!contact?.id) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setMessages([]);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    (async () => {
      const { data: conv } = await supabase
        .from("conversations")
        .select("id")
        .eq("contact_id", contact.id)
        .order("last_message_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (!conv) {
        if (!cancelled) {
          setMessages([]);
          setLoading(false);
        }
        return;
      }
      const { data } = await supabase
        .from("messages")
        .select("*")
        .eq("conversation_id", conv.id)
        .in("content_type", MEDIA_CONTENT_TYPES)
        .is("deleted_at", null)
        .order("created_at", { ascending: false });
      if (cancelled) return;
      setMessages((data ?? []) as Message[]);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [contact, supabase]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!contact) {
    return <p className="text-sm text-muted-foreground">{t("noContact")}</p>;
  }

  if (messages.length === 0) {
    return <p className="text-sm text-muted-foreground">{t("filesEmpty")}</p>;
  }

  return (
    <ul className="space-y-2">
      {messages.map((m) => (
        <li key={m.id}>
          <a
            href={m.media_url}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-3 rounded-lg border border-border/50 p-2 transition-colors hover:border-border hover:bg-muted"
          >
            {m.content_type === "image" && m.media_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={m.media_url}
                alt={m.media_filename || t("tabFiles")}
                className="h-12 w-12 shrink-0 rounded-md object-cover"
              />
            ) : m.content_type === "video" ? (
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-md bg-card-2">
                <File className="h-5 w-5 text-muted-foreground" />
              </div>
            ) : m.content_type === "audio" ? (
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-md bg-card-2">
                <FileAudio className="h-5 w-5 text-muted-foreground" />
              </div>
            ) : (
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-md bg-card-2">
                <FileText className="h-5 w-5 text-muted-foreground" />
              </div>
            )}
            <div className="min-w-0 flex-1">
              <p className="truncate text-xs font-medium text-foreground">
                {m.media_filename || t(`fileType.${m.content_type}`)}
              </p>
              <p className="text-[11px] text-muted-foreground">{formatDate(m.created_at)}</p>
            </div>
          </a>
        </li>
      ))}
    </ul>
  );
}
