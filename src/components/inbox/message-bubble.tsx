"use client";

import { useState, useEffect, useCallback } from "react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import type { Message, MessageReaction } from "@/types";
import {
  Clock,
  Check,
  CheckCheck,
  XCircle,
  FileText,
  MapPin,
  LayoutTemplate,
  ImageOff,
  CornerDownLeft,
  Download,
  Ban,
  X,
} from "lucide-react";
import { format } from "date-fns";
import { ReplyQuote } from "./reply-quote";
import { MessageReactions } from "./message-reactions";
import { extensionForMimeType } from "@/lib/whatsapp/mime";

interface MessageBubbleProps {
  message: Message;
  /** Pre-computed quote info for messages that reply to another. */
  reply?: { authorLabel: string; preview: string } | null;
  reactions?: MessageReaction[];
  currentUserId?: string;
  onToggleReaction?: (emoji: string) => void;
  /** CRM-local inline edit (see Message.edited_at) — all optional so
   *  callers that don't support editing don't need to wire it up. */
  isEditing?: boolean;
  editValue?: string;
  onEditValueChange?: (value: string) => void;
  onSaveEdit?: () => void;
  onCancelEdit?: () => void;
  editSaving?: boolean;
}

function StatusIcon({ status }: { status: Message["status"] }) {
  switch (status) {
    case "sending":
      return <Clock className="h-3 w-3 text-muted-foreground" />;
    case "sent":
      return <Check className="h-3 w-3 text-muted-foreground" />;
    case "delivered":
      return <CheckCheck className="h-3 w-3 text-muted-foreground" />;
    case "read":
      return <CheckCheck className="h-3 w-3 text-blue-400" />;
    case "failed":
      return <XCircle className="h-3 w-3 text-red-400" />;
    default:
      return null;
  }
}

/**
 * Fetch + blob download rather than a plain `<a download>` — the
 * `download` attribute is silently ignored by browsers when the href
 * is cross-origin (the Supabase Storage CDN vs. this app's own
 * origin), which would otherwise just open the file in a new tab
 * instead of saving it.
 */
async function downloadMediaBlob(url: string, filename: string) {
  const res = await fetch(url);
  const blob = await res.blob();
  const blobUrl = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = blobUrl;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(blobUrl);
}

/** Hover-reveal download affordance for images/videos — positioned by
 *  the caller's `relative group` wrapper. */
function MediaDownloadButton({ url, filename }: { url: string; filename: string }) {
  const t = useTranslations("inbox.bubble");
  const handleDownload = useCallback(
    async (e: React.MouseEvent) => {
      e.stopPropagation();
      try {
        await downloadMediaBlob(url, filename);
      } catch {
        // Best-effort — a failed download shouldn't throw in the UI;
        // the user can still open the media directly (image click / video controls).
      }
    },
    [url, filename],
  );

  return (
    <button
      type="button"
      onClick={handleDownload}
      aria-label={t("downloadAria")}
      title={t("downloadAria")}
      className="absolute bottom-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity bg-black/50 rounded p-1"
    >
      <Download className="h-4 w-4 text-white" />
    </button>
  );
}

function MediaUnavailable({ label }: { label: string }) {
  const t = useTranslations("inbox.bubble");
  return (
    <div className="flex items-center gap-2 rounded-lg bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
      <ImageOff className="h-4 w-4 shrink-0 text-muted-foreground" />
      <span>{label} {t("unavailableSuffix")}</span>
    </div>
  );
}

function MediaImage({ url, alt, filename }: { url: string; alt: string; filename: string }) {
  const [src, setSrc] = useState<string | null>(null);
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(true);

  const loadImage = useCallback(async () => {
    if (!url) return;

    // Proxy URLs need auth fetch to create blob URL
    if (url.startsWith("/api/whatsapp/media/")) {
      try {
        const res = await fetch(url);
        if (!res.ok) throw new Error("Failed to load media");
        const blob = await res.blob();
        const blobUrl = URL.createObjectURL(blob);
        setSrc(blobUrl);
      } catch {
        setError(true);
      } finally {
        setLoading(false);
      }
    } else {
      setSrc(url);
      setLoading(false);
    }
  }, [url]);

  useEffect(() => {
    loadImage();
    return () => {
      if (src?.startsWith("blob:")) {
        URL.revokeObjectURL(src);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadImage]);

  if (error) {
    return (
      <div className="flex h-40 w-60 items-center justify-center rounded-lg bg-muted">
        <ImageOff className="h-8 w-8 text-muted-foreground" />
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex h-40 w-60 items-center justify-center rounded-lg bg-muted">
        <div className="h-5 w-5 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="group relative inline-block">
      <img
        src={src ?? ""}
        alt={alt}
        className="max-h-64 max-w-60 rounded-lg object-cover"
        onError={() => setError(true)}
      />
      <MediaDownloadButton url={url} filename={filename} />
    </div>
  );
}

function MessageContent({ message, isAgent }: { message: Message; isAgent: boolean }) {
  const t = useTranslations("inbox.bubble");

  if (message.deleted_at) {
    return (
      <p
        className={cn(
          "flex items-center gap-1.5 text-sm italic",
          // Deleted messages only ever appear on agent-sent (primary-tinted)
          // bubbles today — see MessageActions, only agent messages get the
          // delete action — so this branch doesn't need the customer case,
          // but stays defensive in case that ever changes.
          isAgent ? "text-primary-foreground/70" : "text-muted-foreground",
        )}
      >
        <Ban className="h-3.5 w-3.5 shrink-0" />
        {t("deletedPlaceholder")}
      </p>
    );
  }

  switch (message.content_type) {
    case "text":
      return (
        <p className="whitespace-pre-wrap break-words text-sm">
          {message.content_text}
        </p>
      );

    case "image":
      return (
        <div>
          {message.media_url ? (
            <MediaImage
              url={message.media_url}
              alt={t("sharedImageAlt")}
              filename={
                message.media_filename ||
                `${t("imageFilenamePrefix")}.${extensionForMimeType(message.media_mime_type)}`
              }
            />
          ) : (
            <MediaUnavailable label={t("imageLabel")} />
          )}
          {message.content_text && (
            <p className="mt-1 whitespace-pre-wrap break-words text-sm">
              {message.content_text}
            </p>
          )}
        </div>
      );

    case "video":
      return (
        <div>
          {message.media_url ? (
            <div className="group relative inline-block">
              <video
                src={message.media_url}
                controls
                className="max-h-64 max-w-60 rounded-lg"
              />
              <MediaDownloadButton
                url={message.media_url}
                filename={
                  message.media_filename ||
                  `${t("videoFilenamePrefix")}.${extensionForMimeType(message.media_mime_type)}`
                }
              />
            </div>
          ) : (
            <MediaUnavailable label={t("videoLabel")} />
          )}
          {message.content_text && (
            <p className="mt-1 whitespace-pre-wrap break-words text-sm">
              {message.content_text}
            </p>
          )}
        </div>
      );

    case "audio":
      return (
        <div>
          {message.media_url ? (
            <audio src={message.media_url} controls className="max-w-60" />
          ) : (
            <MediaUnavailable label={t("audioLabel")} />
          )}
        </div>
      );

    case "document": {
      const label = message.media_filename || message.content_text || t("documentLabel");
      if (!message.media_url) {
        return <MediaUnavailable label={label} />;
      }
      return (
        <a
          href={message.media_url}
          download={message.media_filename || undefined}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-2 rounded-lg bg-muted/50 px-3 py-2 text-sm hover:bg-muted"
        >
          <FileText className="h-5 w-5 shrink-0 text-muted-foreground" />
          <span className="truncate">{label}</span>
          <Download className="h-4 w-4 shrink-0 text-muted-foreground ml-auto" />
        </a>
      );
    }

    case "template":
      return (
        <div>
          <span className="mb-1 inline-flex items-center gap-1 rounded bg-primary/20 px-1.5 py-0.5 text-[10px] font-medium text-primary">
            <LayoutTemplate className="h-3 w-3" />
            {t("templateBadge")}
          </span>
          {message.content_text && (
            <p className="mt-1 whitespace-pre-wrap break-words text-sm">
              {message.content_text}
            </p>
          )}
        </div>
      );

    case "location":
      return (
        <div className="flex items-center gap-2 text-sm">
          <MapPin className="h-4 w-4 shrink-0 text-muted-foreground" />
          <span>{message.content_text || t("locationShared")}</span>
        </div>
      );

    case "interactive": {
      // Customer tapped a reply button or list row on a message the bot
      // sent. We show the tapped option's title (already in content_text,
      // set by parseMessageContent in the webhook) with a small affordance
      // so agents reading the inbox can tell at a glance that this is a
      // tap rather than the customer typing the same words.
      return (
        <div className="flex flex-col gap-0.5">
          <span className="inline-flex items-center gap-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            <CornerDownLeft className="h-3 w-3" />
            {t("buttonReply")}
          </span>
          <p className="whitespace-pre-wrap break-words text-sm">
            {message.content_text || t("interactiveReplyFallback")}
          </p>
        </div>
      );
    }

    default:
      return (
        <p className="whitespace-pre-wrap break-words text-sm">
          {message.content_text || t("unsupportedMessageType")}
        </p>
      );
  }
}

/** Inline replacement for <MessageContent> while an agent message is
 *  being edited — see MessageBubble's `isEditing` prop. */
function EditMessageForm({
  value,
  onChange,
  onSave,
  onCancel,
  saving,
  isAgent,
}: {
  value: string;
  onChange: (value: string) => void;
  onSave: () => void;
  onCancel: () => void;
  saving?: boolean;
  isAgent: boolean;
}) {
  const t = useTranslations("inbox.bubble");
  return (
    <div className="flex min-w-[200px] flex-col gap-1.5">
      <textarea
        autoFocus
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            onSave();
          } else if (e.key === "Escape") {
            onCancel();
          }
        }}
        rows={2}
        className={cn(
          "w-full resize-none rounded-lg border bg-transparent px-2 py-1.5 text-sm outline-none",
          isAgent
            ? "border-primary-foreground/30 placeholder:text-primary-foreground/50"
            : "border-border placeholder:text-muted-foreground",
        )}
      />
      <div className="flex items-center justify-between gap-2">
        <span
          className={cn(
            "text-[10px]",
            isAgent ? "text-primary-foreground/60" : "text-muted-foreground",
          )}
        >
          {t("editLocalOnlyHint")}
        </span>
        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            onClick={onCancel}
            className={cn(
              "rounded px-2 py-0.5 text-xs font-medium transition-colors",
              isAgent ? "hover:bg-primary-foreground/10" : "hover:bg-muted",
            )}
          >
            {t("cancelEdit")}
          </button>
          <button
            type="button"
            onClick={onSave}
            disabled={saving || !value.trim()}
            className={cn(
              "rounded px-2 py-0.5 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50",
              isAgent
                ? "bg-primary-foreground/15 hover:bg-primary-foreground/25"
                : "bg-primary/10 text-primary hover:bg-primary/20",
            )}
          >
            {saving ? t("savingEdit") : t("saveEdit")}
          </button>
        </div>
      </div>
    </div>
  );
}

export function MessageBubble({
  message,
  reply,
  reactions,
  currentUserId,
  onToggleReaction,
  isEditing,
  editValue,
  onEditValueChange,
  onSaveEdit,
  onCancelEdit,
  editSaving,
}: MessageBubbleProps) {
  const t = useTranslations("inbox.bubble");
  const isAgent = message.sender_type === "agent" || message.sender_type === "bot";
  const time = format(new Date(message.created_at), "HH:mm");
  const editedTag = t("editedTag");

  // Row alignment + width cap are owned by <MessageActions> so its hover
  // group matches the bubble's content area, not the full row.
  return (
    <div
      className={cn(
        "flex flex-col",
        isAgent ? "items-end" : "items-start",
      )}
    >
      <div
        className={cn(
          "relative rounded-2xl px-3 py-2",
          isAgent
            ? "rounded-br-md bg-primary text-primary-foreground"
            : "rounded-bl-md bg-muted text-foreground",
        )}
      >
        {reply && (
          <ReplyQuote
            authorLabel={reply.authorLabel}
            preview={reply.preview}
            onPrimary={isAgent}
          />
        )}
        {isEditing ? (
          <EditMessageForm
            value={editValue ?? ""}
            onChange={onEditValueChange ?? (() => {})}
            onSave={onSaveEdit ?? (() => {})}
            onCancel={onCancelEdit ?? (() => {})}
            saving={editSaving}
            isAgent={isAgent}
          />
        ) : (
          <MessageContent message={message} isAgent={isAgent} />
        )}
        <div
          className={cn(
            "mt-1 flex items-center gap-1",
            isAgent ? "justify-end" : "justify-start",
          )}
        >
          {message.edited_at && !message.deleted_at && (
            <span
              className={cn(
                "text-[10px] italic",
                isAgent ? "text-primary-foreground/60" : "text-muted-foreground/80",
              )}
            >
              {editedTag}
            </span>
          )}
          <span
            className={cn(
              "text-[10px]",
              // Outbound bubbles sit on the primary fill, so the
              // timestamp must read against that (not the neutral
              // foreground) — otherwise it goes low-contrast in light
              // mode. Inbound bubbles use the muted surface.
              isAgent ? "text-primary-foreground/70" : "text-muted-foreground",
            )}
          >
            {time}
          </span>
          {isAgent && <StatusIcon status={message.status} />}
        </div>
      </div>
      {reactions && reactions.length > 0 && onToggleReaction && (
        <MessageReactions
          reactions={reactions}
          currentUserId={currentUserId}
          onToggle={onToggleReaction}
        />
      )}
    </div>
  );
}
