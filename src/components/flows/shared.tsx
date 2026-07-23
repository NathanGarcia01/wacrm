/**
 * Shared editor primitives used by both the linear-list and canvas
 * views of a flow.
 *
 * What lives here vs in flow-builder.tsx / flow-canvas.tsx:
 *   - Types and metadata that BOTH views need to render a node
 *     consistently (icon, label, color, 1-line summary).
 *   - Editing-only helpers (defaultConfigFor, slugify, uniqueNodeKey,
 *     BuilderState) stay in flow-builder.tsx until the canvas grows
 *     editing affordances — pulled across in the PR that adds them.
 *
 * Why .tsx and not .ts: NODE_META holds lucide icon components, which
 * are typed as React components; importing them from a .ts module
 * works at runtime but trips TypeScript's
 * `verbatimModuleSyntax`-related linting in some setups. Keeping the
 * file .tsx future-proofs it for inline JSX in node-card renderers.
 */

import {
  Clock,
  Flag,
  GitFork,
  Inbox,
  ListChecks,
  ListPlus,
  MessageCircle,
  OctagonX,
  Paperclip,
  PlayCircle,
  Rocket,
  Shuffle,
  Tag,
  UserPlus,
  Workflow,
} from "lucide-react";

// ============================================================
// Node-type union — single source of truth for every place the UI
// enumerates types (add menu, type pickers, switch statements). Kept
// in lockstep with `FlowNodeType` in src/lib/flows/types.ts (which
// drives the engine's exhaustiveness check); a divergence between the
// two is always a bug.
// ============================================================

export type NodeType =
  | "start"
  | "send_message"
  | "send_buttons"
  | "send_list"
  | "send_media"
  | "collect_input"
  | "wait"
  | "condition"
  | "randomizer"
  | "set_tag"
  | "start_flow"
  | "stop_flow"
  | "handoff"
  | "end";

export interface BuilderNode {
  node_key: string;
  node_type: NodeType;
  config: Record<string, unknown>;
  /** Optional in v1 — defaults to 0 in the DB. Canvas view reads it
   *  to position nodes; list view ignores it. */
  position_x?: number;
  position_y?: number;
}

// ============================================================
// Per-node-type metadata used to render icons + labels everywhere
// the user sees a node summary.
// ============================================================

/**
 * No `label` here — this is a plain data module (not a component), so
 * it can't call `useTranslations`. Consumers render the label via
 * `useTranslations('flows.nodeTypes')` and `t(nodeType)` — every
 * `NodeType` value below is itself a key in that messages namespace.
 */
export const NODE_META: Record<
  NodeType,
  { icon: typeof Workflow; color: string }
> = {
  start: { icon: PlayCircle, color: "text-primary" },
  send_message: {
    icon: MessageCircle,
    color: "text-sky-400",
  },
  send_buttons: {
    icon: ListChecks,
    color: "text-primary",
  },
  send_list: {
    icon: ListPlus,
    color: "text-indigo-400",
  },
  send_media: {
    icon: Paperclip,
    color: "text-cyan-400",
  },
  collect_input: {
    icon: Inbox,
    color: "text-teal-400",
  },
  wait: {
    icon: Clock,
    color: "text-amber-400",
  },
  condition: {
    icon: GitFork,
    color: "text-fuchsia-400",
  },
  randomizer: {
    icon: Shuffle,
    color: "text-fuchsia-400",
  },
  set_tag: {
    icon: Tag,
    color: "text-pink-400",
  },
  start_flow: {
    icon: Rocket,
    color: "text-sky-400",
  },
  stop_flow: {
    icon: OctagonX,
    color: "text-destructive",
  },
  handoff: {
    icon: UserPlus,
    color: "text-gold",
  },
  end: { icon: Flag, color: "text-muted-foreground" },
};

// ============================================================
// Pure editing helpers — used by forms in both views.
// ============================================================

/**
 * Coerce an arbitrary string into a stable identifier (node_key,
 * reply_id, etc.). Lowercases, collapses non-alphanumerics into
 * single underscores, and trims leading/trailing underscores. Falls
 * back to `fallback` for inputs that reduce to an empty string.
 */
export function slugify(s: string, fallback: string): string {
  const cleaned = s
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return cleaned || fallback;
}

// ============================================================
// Summary helpers — short, single-line content previews used in
// collapsed node cards (list view) and node tiles (canvas view).
// Returns null when there's nothing meaningful to show (start/end,
// or a freshly-added node with no fields filled in).
// ============================================================

export function truncate(s: string, max = 80): string {
  const clean = s.replace(/\s+/g, " ").trim();
  if (clean.length <= max) return clean;
  return clean.slice(0, max - 1) + "…";
}

/** Translator shape needed for the node-card preview strings — pass
 *  `useTranslations('flows.summary')` from the caller since this is a
 *  plain module (can't call the hook itself). */
type SummaryT = (key: string, values?: Record<string, string | number | Date>) => string;

export function summarizeNode(node: BuilderNode, t: SummaryT): string | null {
  const cfg = node.config;
  switch (node.node_type) {
    case "start":
    case "end":
      return null;
    case "send_message": {
      const text = typeof cfg.text === "string" ? cfg.text : "";
      return text.length > 0 ? truncate(text) : null;
    }
    case "send_buttons": {
      const text = typeof cfg.text === "string" ? cfg.text : "";
      const buttons = Array.isArray(cfg.buttons)
        ? (cfg.buttons as Array<Record<string, unknown>>)
        : [];
      const titles = buttons
        .map((b) => (typeof b.title === "string" ? b.title : ""))
        .filter(Boolean)
        .join(" / ");
      if (text.length > 0) {
        return titles ? `${truncate(text, 40)} · ${truncate(titles, 35)}` : truncate(text);
      }
      return titles || null;
    }
    case "send_list": {
      const text = typeof cfg.text === "string" ? cfg.text : "";
      const sections = Array.isArray(cfg.sections)
        ? (cfg.sections as Array<Record<string, unknown>>)
        : [];
      const rowCount = sections.reduce<number>((sum, s) => {
        const rows = Array.isArray(s.rows) ? s.rows : [];
        return sum + rows.length;
      }, 0);
      if (text.length > 0) {
        return rowCount > 0
          ? `${truncate(text, 50)} · ${t("option", { count: rowCount })}`
          : truncate(text);
      }
      return rowCount > 0
        ? `${t("option", { count: rowCount })} ${t("inSectionsConnector")} ${t("section", { count: sections.length })}`
        : null;
    }
    case "send_media": {
      const mediaType =
        typeof cfg.media_type === "string" ? cfg.media_type : "";
      const filename = typeof cfg.filename === "string" ? cfg.filename : "";
      const url = typeof cfg.media_url === "string" ? cfg.media_url : "";
      const caption = typeof cfg.caption === "string" ? cfg.caption : "";
      const label = mediaType
        ? mediaType.charAt(0).toUpperCase() + mediaType.slice(1)
        : t("media");
      if (!url) return `${label} ${t("noFileUploaded")}`;
      const name = filename || url.split("/").pop() || t("fileFallback");
      return caption
        ? `${label}: ${truncate(name, 30)} · ${truncate(caption, 40)}`
        : `${label}: ${truncate(name, 60)}`;
    }
    case "collect_input": {
      const prompt = typeof cfg.prompt_text === "string" ? cfg.prompt_text : "";
      const varKey = typeof cfg.var_key === "string" ? cfg.var_key : "";
      if (prompt.length > 0) {
        return varKey ? `${truncate(prompt, 50)} → vars.${varKey}` : truncate(prompt);
      }
      return varKey ? `→ vars.${varKey}` : null;
    }
    case "wait": {
      const amount = typeof cfg.amount === "number" ? cfg.amount : null;
      if (amount === null) return null;
      const unit = cfg.unit === "hours" ? "hours" : cfg.unit === "days" ? "days" : "minutes";
      const durationKey =
        unit === "hours" ? "waitHours" : unit === "days" ? "waitDays" : "waitMinutes";
      return t("waitSummary", { duration: t(durationKey, { count: amount }) });
    }
    case "condition": {
      const subjectKey =
        typeof cfg.subject_key === "string" ? cfg.subject_key : "";
      if (!subjectKey) return null;
      const subject =
        cfg.subject === "tag"
          ? "tag"
          : cfg.subject === "contact_field"
            ? "field"
            : "var";
      const subjectStr =
        subject === "tag"
          ? t("hasTag", { key: truncate(subjectKey, 24) })
          : `${subject}.${subjectKey}`;
      const op =
        cfg.operator === "equals"
          ? "=="
          : cfg.operator === "contains"
            ? t("opContains")
            : cfg.operator === "present"
              ? t("opExists")
              : cfg.operator === "absent"
                ? t("opAbsent")
                : "";
      const value = typeof cfg.value === "string" ? cfg.value : "";
      const valStr =
        (cfg.operator === "equals" || cfg.operator === "contains") && value
          ? ` "${truncate(value, 20)}"`
          : "";
      return subject === "tag" ? subjectStr : `${subjectStr} ${op}${valStr}`;
    }
    case "randomizer": {
      const pct = typeof cfg.split_percent === "number" ? cfg.split_percent : 50;
      return t("randomizerSummary", { pct });
    }
    case "set_tag": {
      const mode = cfg.mode === "remove" ? t("modeRemove") : t("modeAdd");
      const tagId = typeof cfg.tag_id === "string" ? cfg.tag_id : "";
      // No tag name available without an async lookup here; show a
      // short prefix of the UUID so users can disambiguate between
      // multiple set_tag nodes at a glance.
      return tagId ? `${mode} tag ${tagId.slice(0, 8)}…` : `${mode} tag ${t("noneSelected")}`;
    }
    case "start_flow": {
      const flowId = typeof cfg.flow_id === "string" ? cfg.flow_id : "";
      // No flow name available without an async lookup here — same
      // trade-off as set_tag's UUID-prefix display above.
      return flowId ? `${t("startFlowSummary")} ${flowId.slice(0, 8)}…` : null;
    }
    case "stop_flow":
      return t("stopFlowSummary");
    case "handoff": {
      const note = typeof cfg.note === "string" ? cfg.note : "";
      return note.length > 0 ? truncate(note) : null;
    }
  }
}
