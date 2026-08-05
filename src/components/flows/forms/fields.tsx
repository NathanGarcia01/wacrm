"use client";

/**
 * Reusable field components shared across every per-node form.
 *
 * `NodeKeySelect` — picks a node from the flow's node list, rendered
 * with the source node's icon so the dropdown reads as
 * "destination = ◇ menu" rather than an opaque slug.
 *
 * `NextNodeRow` — wraps NodeKeySelect with a label; the most common
 * per-node form row ("after this node, advance to…").
 *
 * `TextRow` — wraps Input or Textarea behind a label. Pure UI sugar
 * to keep per-node forms uncluttered.
 *
 * Lives in src/components/flows/forms/ so both the list view's
 * collapsed-card editor and the canvas view's side-panel editor
 * (introduced in this PR) mount the exact same form components.
 */

import { useTranslations } from "next-intl";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { NODE_META, type BuilderNode } from "../shared";

/** Named tokens `resolveVariables` (src/lib/flows/variables.ts) resolves
 *  at send time — kept in sync with that file's switch by hand, since
 *  it's a fixed, rarely-changing vocabulary. */
export const FLOW_VARIABLE_KEYS = [
  "nome",
  "primeiro_nome",
  "telefone",
  "email",
  "atendente",
  "empresa",
  "data",
  "hora",
] as const;

/** Clickable `{{token}}` chips — insert into whichever text field
 *  `onInsert` is wired to. Used below send_message's text field and
 *  send_template's per-placeholder inputs so authors don't have to
 *  memorize the variable vocabulary. */
export function VariableChips({ onInsert }: { onInsert: (token: string) => void }) {
  const t = useTranslations("flows.forms");
  return (
    <div className="mt-1.5 flex flex-wrap items-center gap-1">
      <span className="mr-0.5 text-[10px] text-muted-foreground">
        {t("variablesHint")}
      </span>
      {FLOW_VARIABLE_KEYS.map((key) => (
        <button
          key={key}
          type="button"
          onClick={() => onInsert(`{{${key}}}`)}
          className="rounded-full border border-border bg-muted px-2 py-0.5 font-mono text-[10px] text-muted-foreground transition-colors hover:border-primary/50 hover:text-foreground"
        >
          {`{{${key}}}`}
        </button>
      ))}
    </div>
  );
}

export function TextRow({
  label,
  value,
  onChange,
  rows = 1,
  variableChips = false,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  rows?: number;
  /** Renders the {{nome}}/{{telefone}}/… insertion chips below the field. */
  variableChips?: boolean;
}) {
  return (
    <div>
      <label className="mb-1 block text-xs text-muted-foreground">{label}</label>
      {rows > 1 ? (
        <Textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          rows={rows}
          className="bg-muted"
        />
      ) : (
        <Input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="bg-muted"
        />
      )}
      {variableChips && (
        <VariableChips onInsert={(token) => onChange(value ? `${value} ${token}` : token)} />
      )}
    </div>
  );
}

export function NextNodeRow({
  value,
  allNodes,
  currentKey,
  onChange,
  label,
}: {
  value: string;
  allNodes: BuilderNode[];
  currentKey: string;
  onChange: (v: string) => void;
  label: string;
}) {
  const t = useTranslations("flows.forms");
  return (
    <div>
      <label className="mb-1 block text-xs text-muted-foreground">{label}</label>
      <NodeKeySelect
        value={value || null}
        nodes={allNodes}
        excludeKey={currentKey}
        onChange={(v) => onChange(v ?? "")}
        placeholder={t("chooseNextNodePlaceholder")}
      />
    </div>
  );
}

export function NodeKeySelect({
  value,
  nodes,
  excludeKey,
  onChange,
  placeholder,
  className,
}: {
  value: string | null;
  nodes: BuilderNode[];
  excludeKey?: string;
  onChange: (v: string | null) => void;
  placeholder?: string;
  className?: string;
}) {
  const t = useTranslations("flows.forms");
  const options = nodes.filter((n) => n.node_key !== excludeKey);
  return (
    <Select
      value={value ?? "__none__"}
      onValueChange={(v) => onChange(v === "__none__" ? null : v)}
    >
      <SelectTrigger className={cn("bg-muted", className)}>
        <SelectValue placeholder={placeholder ?? "—"} />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="__none__">{t("noneOption")}</SelectItem>
        {options.map((n) => {
          const Icon = NODE_META[n.node_type].icon;
          return (
            <SelectItem key={n.node_key} value={n.node_key}>
              <span className="inline-flex items-center gap-1.5">
                <Icon
                  className={cn("h-3 w-3", NODE_META[n.node_type].color)}
                />
                {n.node_key}
              </span>
            </SelectItem>
          );
        })}
      </SelectContent>
    </Select>
  );
}
