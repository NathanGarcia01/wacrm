"use client";

import { useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { CornerUpLeft, Copy, SmilePlus, MoreVertical, Pencil, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { Message } from "@/types";

// WhatsApp's own quick-reaction bar starts with these six. Picking the same
// set keeps the affordance familiar without pulling in a 300KB emoji library.
const QUICK_EMOJIS = ["👍", "❤️", "😂", "😮", "😢", "🙏"];

// Edit is only offered for a short window after sending — mirrors the
// "you can still fix a typo" affordance without pretending it's a real
// edit on the customer's WhatsApp (it never is, see MessageBubble).
const EDIT_WINDOW_MINUTES = 15;

interface MessageActionsProps {
  message: Message;
  onReply: () => void;
  onReact: (emoji: string) => void;
  /** Undefined = editing not wired up by the caller (e.g. not a real, synced message yet). */
  onEdit?: () => void;
  /** Undefined = deleting not wired up by the caller. */
  onDelete?: () => void;
  children: ReactNode;
}

/**
 * Hover/long-press toolbar wrapper around a `<MessageBubble>`. The bubble
 * itself stays a pure presenter — this component owns the action surface so
 * the bubble's render path is unaffected when the toolbar isn't visible.
 */
export function MessageActions({
  message,
  onReply,
  onReact,
  onEdit,
  onDelete,
  children,
}: MessageActionsProps) {
  const t = useTranslations("inbox.messageActions");
  // Touch devices have no hover. Long-press fires `contextmenu`; we capture
  // it, suppress the native menu, and pin the toolbar open until the user
  // interacts elsewhere.
  const [touchOpen, setTouchOpen] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  const isAgent =
    message.sender_type === "agent" || message.sender_type === "bot";

  // A deleted message keeps its placeholder bubble but loses every
  // action — matches WhatsApp's own behavior for a removed message.
  if (message.deleted_at) {
    return (
      <div className={cn("flex w-full", isAgent ? "justify-end" : "justify-start")}>
        <div className="min-w-0 max-w-[75%]">{children}</div>
      </div>
    );
  }

  // Not a real, already-synced message yet (still sending) — editing/
  // deleting a message that hasn't landed in the DB doesn't make sense.
  const isSynced = !message.id.startsWith("temp-");
  const withinEditWindow =
    Date.now() - new Date(message.created_at).getTime() <=
    EDIT_WINDOW_MINUTES * 60_000;
  const canEdit =
    isAgent && isSynced && message.content_type === "text" && withinEditWindow && !!onEdit;
  const canDelete = isAgent && isSynced && !!onDelete;

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    setTouchOpen(true);
  };

  const handleCopy = async () => {
    const text = message.content_text ?? "";
    if (!text) {
      toast.error(t("nothingToCopy"));
      return;
    }
    try {
      await navigator.clipboard.writeText(text);
      toast.success(t("copied"));
    } catch {
      toast.error(t("copyFailed"));
    }
    setTouchOpen(false);
  };

  const handlePickEmoji = (emoji: string) => {
    onReact(emoji);
    setPickerOpen(false);
    setTouchOpen(false);
  };

  const handleReply = () => {
    onReply();
    setTouchOpen(false);
  };

  const handleEdit = () => {
    onEdit?.();
    setMenuOpen(false);
    setTouchOpen(false);
  };

  const handleDelete = () => {
    // Blocking confirm on purpose — the disclaimer must be read every
    // time, since "delete" here never reaches the customer's WhatsApp.
    if (!window.confirm(t("deleteConfirm"))) {
      setMenuOpen(false);
      return;
    }
    onDelete?.();
    setMenuOpen(false);
    setTouchOpen(false);
  };

  // Row alignment lives here (not in MessageBubble) so the `group/actions`
  // hover region matches the bubble's content width — hovering empty space
  // in the row no longer reveals the toolbar.
  return (
    <div
      className={cn(
        "flex w-full",
        isAgent ? "justify-end" : "justify-start",
      )}
      onContextMenu={handleContextMenu}
      onBlur={() => setTouchOpen(false)}
    >
      {/* `min-w-0` lets this flex child actually respect the 75% cap.
       *  Default `min-width: auto` lets content (a long quote preview,
       *  an unbroken URL) push past the cap and shove the row past
       *  100%, which used to bleed across into the contact-sidebar
       *  area. See issue #165. */}
      <div className="group/actions relative min-w-0 max-w-[75%]">
        {children}
      <div
        data-touch-open={touchOpen || pickerOpen || menuOpen ? "true" : undefined}
        className={cn(
          "absolute -top-3 z-10 flex h-7 items-center gap-0.5 rounded-full border border-border bg-popover/95 px-1 shadow-md backdrop-blur-sm transition-opacity",
          "opacity-0 group-hover/actions:opacity-100 group-focus-within/actions:opacity-100",
          "data-[touch-open=true]:opacity-100",
          isAgent ? "right-3" : "left-3",
        )}
      >
        <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
          <PopoverTrigger
            className="flex h-5 w-5 items-center justify-center rounded-full text-popover-foreground hover:bg-muted hover:text-foreground"
            aria-label={t("reactAria")}
          >
            <SmilePlus className="h-3.5 w-3.5" />
          </PopoverTrigger>
          <PopoverContent
            className="flex w-auto flex-row gap-1 p-1.5"
            sideOffset={6}
          >
            {QUICK_EMOJIS.map((e) => (
              <button
                key={e}
                type="button"
                onClick={() => handlePickEmoji(e)}
                className="flex h-8 w-8 items-center justify-center rounded-full text-lg leading-none transition-transform hover:scale-125 hover:bg-muted"
                aria-label={t("reactWithAria", { emoji: e })}
              >
                {e}
              </button>
            ))}
          </PopoverContent>
        </Popover>
        <button
          type="button"
          onClick={handleReply}
          className="flex h-5 w-5 items-center justify-center rounded-full text-popover-foreground hover:bg-muted hover:text-foreground"
          aria-label={t("replyAria")}
        >
          <CornerUpLeft className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          onClick={handleCopy}
          className="flex h-5 w-5 items-center justify-center rounded-full text-popover-foreground hover:bg-muted hover:text-foreground"
          aria-label={t("copyAria")}
        >
          <Copy className="h-3.5 w-3.5" />
        </button>
        {(canEdit || canDelete) && (
          <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
            <DropdownMenuTrigger
              className="flex h-5 w-5 items-center justify-center rounded-full text-popover-foreground hover:bg-muted hover:text-foreground"
              aria-label={t("moreAria")}
            >
              <MoreVertical className="h-3.5 w-3.5" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align={isAgent ? "end" : "start"}>
              {canEdit && (
                <DropdownMenuItem onClick={handleEdit}>
                  <Pencil className="mr-2 h-3.5 w-3.5" />
                  {t("editMessage")}
                </DropdownMenuItem>
              )}
              {canDelete && (
                <DropdownMenuItem onClick={handleDelete} variant="destructive">
                  <Trash2 className="mr-2 h-3.5 w-3.5" />
                  {t("deleteMessage")}
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
      </div>
    </div>
  );
}
