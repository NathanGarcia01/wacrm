"use client"

import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react"
import { useRouter } from "next/navigation"
import { useTranslations } from "next-intl"
import { toast } from "sonner"
import {
  ArrowLeft,
  ChevronDown,
  Plus,
  Trash2,
  GripVertical,
  MessageSquare,
  FileText,
  Tag,
  TagIcon,
  UserCheck,
  PencilLine,
  Briefcase,
  Hourglass,
  GitBranch,
  Webhook,
  CircleSlash,
  Zap,
  Loader2,
  ArrowDown,
  ArrowUp,
  UserX,
  ArrowRightLeft,
  DollarSign,
  Trophy,
  XCircle,
  MessageCircle,
  Clock,
  Shuffle,
  PlayCircle,
  StopCircle,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Switch } from "@/components/ui/switch"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import type {
  AccountMember,
  AutomationStepType,
  AutomationTriggerType,
  CustomField,
  KeywordMatchTriggerConfig,
  MessageTemplate,
  Pipeline,
  PipelineStage,
  Tag as TagRecord,
} from "@/types"
import { createClient } from "@/lib/supabase/client"
import { cn } from "@/lib/utils"

// ------------------------------------------------------------
// Types (builder-local — mirror the flattened rows we POST)
// ------------------------------------------------------------

export interface BuilderStep {
  /** Client id; the API assigns real UUIDs server-side. */
  cid: string
  step_type: AutomationStepType
  step_config: Record<string, unknown>
  branches?: { yes: BuilderStep[]; no: BuilderStep[] }
}

export interface BuilderInitial {
  id?: string
  name: string
  description: string
  trigger_type: AutomationTriggerType
  trigger_config: Record<string, unknown>
  is_active: boolean
  steps: BuilderStep[]
}

// ------------------------------------------------------------
// Step metadata — one source of truth for icon + label + border color
// ------------------------------------------------------------

interface StepMeta {
  labelKey: string
  icon: typeof Zap
  /** Left-border accent color per spec. */
  border: string
}

const STEP_META: Record<AutomationStepType, StepMeta> = {
  send_message: { labelKey: "stepSendMessage", icon: MessageSquare, border: "border-l-primary" },
  send_template: { labelKey: "stepSendTemplate", icon: FileText, border: "border-l-primary" },
  add_tag: { labelKey: "stepAddTag", icon: Tag, border: "border-l-primary" },
  remove_tag: { labelKey: "stepRemoveTag", icon: TagIcon, border: "border-l-primary" },
  assign_conversation: { labelKey: "stepAssignConversation", icon: UserCheck, border: "border-l-primary" },
  update_contact_field: { labelKey: "stepUpdateContactField", icon: PencilLine, border: "border-l-primary" },
  create_deal: { labelKey: "stepCreateDeal", icon: Briefcase, border: "border-l-primary" },
  wait: { labelKey: "stepWait", icon: Hourglass, border: "border-l-border" },
  condition: { labelKey: "stepCondition", icon: GitBranch, border: "border-l-gold" },
  send_webhook: { labelKey: "stepSendWebhook", icon: Webhook, border: "border-l-primary" },
  open_conversation: { labelKey: "stepOpenConversation", icon: MessageCircle, border: "border-l-primary" },
  set_conversation_pending: { labelKey: "stepSetConversationPending", icon: Clock, border: "border-l-primary" },
  close_conversation: { labelKey: "stepCloseConversation", icon: CircleSlash, border: "border-l-primary" },
  unassign_agent: { labelKey: "stepUnassignAgent", icon: UserX, border: "border-l-primary" },
  update_deal_stage: { labelKey: "stepUpdateDealStage", icon: ArrowRightLeft, border: "border-l-primary" },
  update_deal_value: { labelKey: "stepUpdateDealValue", icon: DollarSign, border: "border-l-primary" },
  mark_deal_won: { labelKey: "stepMarkDealWon", icon: Trophy, border: "border-l-primary" },
  mark_deal_lost: { labelKey: "stepMarkDealLost", icon: XCircle, border: "border-l-primary" },
  randomizer: { labelKey: "stepRandomizer", icon: Shuffle, border: "border-l-gold" },
  start_automation: { labelKey: "stepStartAutomation", icon: PlayCircle, border: "border-l-primary" },
  stop_automation: { labelKey: "stepStopAutomation", icon: StopCircle, border: "border-l-primary" },
}

const ADDABLE_STEPS: AutomationStepType[] = [
  "send_message",
  "send_template",
  "add_tag",
  "remove_tag",
  "assign_conversation",
  "unassign_agent",
  "update_contact_field",
  "create_deal",
  "update_deal_stage",
  "update_deal_value",
  "mark_deal_won",
  "mark_deal_lost",
  "wait",
  "condition",
  "randomizer",
  "start_automation",
  "stop_automation",
  "send_webhook",
  "open_conversation",
  "set_conversation_pending",
  "close_conversation",
]

const TRIGGER_OPTIONS: { value: AutomationTriggerType; labelKey: string; hintKey: string }[] = [
  { value: "new_message_received", labelKey: "triggerNewMessageReceived", hintKey: "triggerNewMessageReceivedHint" },
  { value: "first_inbound_message", labelKey: "triggerFirstInboundMessage", hintKey: "triggerFirstInboundMessageHint" },
  { value: "first_outbound_message", labelKey: "triggerFirstOutboundMessage", hintKey: "triggerFirstOutboundMessageHint" },
  { value: "keyword_match", labelKey: "triggerKeywordMatch", hintKey: "triggerKeywordMatchHint" },
  { value: "new_contact_created", labelKey: "triggerNewContactCreated", hintKey: "triggerNewContactCreatedHint" },
  { value: "conversation_assigned", labelKey: "triggerConversationAssigned", hintKey: "triggerConversationAssignedHint" },
  { value: "tag_added", labelKey: "triggerTagAdded", hintKey: "triggerTagAddedHint" },
  { value: "time_based", labelKey: "triggerTimeBased", hintKey: "triggerTimeBasedHint" },
  { value: "conversation_opened", labelKey: "triggerConversationOpened", hintKey: "triggerConversationOpenedHint" },
  { value: "conversation_closed", labelKey: "triggerConversationClosed", hintKey: "triggerConversationClosedHint" },
  { value: "deal_stage_changed", labelKey: "triggerDealStageChanged", hintKey: "triggerDealStageChangedHint" },
  { value: "deal_won", labelKey: "triggerDealWon", hintKey: "triggerDealWonHint" },
  { value: "deal_lost", labelKey: "triggerDealLost", hintKey: "triggerDealLostHint" },
  { value: "button_clicked", labelKey: "triggerButtonClicked", hintKey: "triggerButtonClickedHint" },
  { value: "nps_received", labelKey: "triggerNpsReceived", hintKey: "triggerNpsReceivedHint" },
  { value: "inactivity", labelKey: "triggerInactivity", hintKey: "triggerInactivityHint" },
]

function cid(): string {
  return (
    "c_" +
    (typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : Math.random().toString(36).slice(2) + Date.now().toString(36))
  )
}

function blankConfig(type: AutomationStepType): Record<string, unknown> {
  switch (type) {
    case "send_message":
      return { text: "" }
    case "send_template":
      return { template_name: "", language: "en_US" }
    case "add_tag":
    case "remove_tag":
      return { tag_id: "" }
    case "assign_conversation":
      return { mode: "round_robin" }
    case "update_contact_field":
      return { field: "name", value: "" }
    case "create_deal":
      return { pipeline_id: "", stage_id: "", title: "", value: 0 }
    case "update_deal_stage":
      return { stage_id: "" }
    case "update_deal_value":
      return { value: 0 }
    case "mark_deal_lost":
      return { reason: "" }
    case "wait":
      return { amount: 1, unit: "hours" }
    case "condition":
      return { subject: "tag_presence", operand: "", value: "" }
    case "randomizer":
      return { split_percent: 50 }
    case "start_automation":
      return { automation_id: "" }
    case "send_webhook":
      return { url: "", headers: {}, body_template: "" }
    case "unassign_agent":
    case "mark_deal_won":
    case "stop_automation":
    case "open_conversation":
    case "set_conversation_pending":
    case "close_conversation":
      return {}
    default:
      return {}
  }
}

// ------------------------------------------------------------
// Account resources (tags, members, approved templates)
//
// Loaded once at the builder root and shared via context so the
// tag / agent / template pickers below can offer existing resources
// by name instead of asking the user to paste raw UUIDs. Every picker
// falls back to a raw input when its list is empty (fresh account or
// an older deployment), so an automation is always authorable.
// ------------------------------------------------------------

interface AutomationOption {
  id: string
  name: string
}

interface AutomationResources {
  tags: TagRecord[]
  members: AccountMember[]
  templates: MessageTemplate[]
  customFields: CustomField[]
  pipelines: Pipeline[]
  stages: PipelineStage[]
  automations: AutomationOption[]
}

const ResourcesContext = createContext<AutomationResources>({
  tags: [],
  members: [],
  templates: [],
  customFields: [],
  pipelines: [],
  stages: [],
  automations: [],
})

function useResources(): AutomationResources {
  return useContext(ResourcesContext)
}

function ResourcesProvider({ children }: { children: ReactNode }) {
  const [tags, setTags] = useState<TagRecord[]>([])
  const [members, setMembers] = useState<AccountMember[]>([])
  const [templates, setTemplates] = useState<MessageTemplate[]>([])
  const [customFields, setCustomFields] = useState<CustomField[]>([])
  const [pipelines, setPipelines] = useState<Pipeline[]>([])
  const [stages, setStages] = useState<PipelineStage[]>([])
  const [automations, setAutomations] = useState<AutomationOption[]>([])

  useEffect(() => {
    let cancelled = false
    const supabase = createClient()

    // Tags, templates, custom fields, pipelines/stages and other
    // automations all come straight from the DB — RLS scopes them to
    // the caller's account. Only APPROVED templates can actually be
    // sent (anything else 400s at send time), matching the broadcast
    // picker.
    void (async () => {
      const [tagsRes, templatesRes, customFieldsRes, pipelinesRes, stagesRes, automationsRes] =
        await Promise.all([
          supabase.from("tags").select("*").order("name"),
          supabase
            .from("message_templates")
            .select("*")
            .eq("status", "APPROVED")
            .order("name"),
          supabase.from("custom_fields").select("*").order("field_name"),
          supabase.from("pipelines").select("*").order("name"),
          supabase.from("pipeline_stages").select("*").order("position"),
          supabase.from("automations").select("id, name").order("name"),
        ])
      if (cancelled) return
      setTags((tagsRes.data as TagRecord[] | null) ?? [])
      setTemplates((templatesRes.data as MessageTemplate[] | null) ?? [])
      setCustomFields((customFieldsRes.data as CustomField[] | null) ?? [])
      setPipelines((pipelinesRes.data as Pipeline[] | null) ?? [])
      setStages((stagesRes.data as PipelineStage[] | null) ?? [])
      setAutomations((automationsRes.data as AutomationOption[] | null) ?? [])
    })()

    // Members go through the API so we inherit its email-visibility
    // rules (agents/viewers don't see emails). Unreachable on older
    // deployments → pickers fall back to a raw agent-id input.
    void (async () => {
      try {
        const res = await fetch("/api/account/members", { cache: "no-store" })
        if (!res.ok) return
        const json = (await res.json()) as { members?: AccountMember[] }
        if (!cancelled) setMembers(json.members ?? [])
      } catch {
        // Members endpoint absent — caller falls back to raw input.
      }
    })()

    return () => {
      cancelled = true
    }
  }, [])

  return (
    <ResourcesContext.Provider
      value={{ tags, members, templates, customFields, pipelines, stages, automations }}
    >
      {children}
    </ResourcesContext.Provider>
  )
}

const SELECT_CLASS =
  "w-full rounded-md border border-border bg-muted px-2 py-1.5 text-sm text-foreground focus:border-primary focus:outline-none"

/** Tag dropdown by name + color, storing the tag's id. Falls back to a
 *  raw id input when no tags exist yet. */
function TagSelect({
  value,
  onChange,
}: {
  value: string
  onChange: (v: string) => void
}) {
  const t = useTranslations("automations.builder")
  const { tags } = useResources()
  if (tags.length === 0) {
    return (
      <Input
        placeholder={t("tagIdPlaceholder")}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="bg-muted text-foreground"
      />
    )
  }
  const selected = tags.find((tag) => tag.id === value)
  return (
    <div className="flex items-center gap-2">
      <span
        className="h-3 w-3 shrink-0 rounded-full border border-border"
        style={{ backgroundColor: selected?.color ?? "transparent" }}
        aria-hidden
      />
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={SELECT_CLASS}
      >
        <option value="">{t("selectTag")}</option>
        {tags.map((tag) => (
          <option key={tag.id} value={tag.id}>
            {tag.name}
          </option>
        ))}
        {/* Preserve a saved tag that's since been deleted so editing an
            existing automation doesn't silently drop it. */}
        {value && !selected && (
          <option value={value}>{t("unknownTagOption", { value })}</option>
        )}
      </select>
    </div>
  )
}

/** Contact-field dropdown for "Update Contact Field": built-in columns plus
 *  any account custom fields (stored as `custom:<id>`). A saved custom field
 *  that's since been deleted is preserved as a labelled option so editing an
 *  existing automation doesn't silently drop it. */
function ContactFieldSelect({
  value,
  onChange,
}: {
  value: string
  onChange: (v: string) => void
}) {
  const t = useTranslations("automations.builder")
  const { customFields } = useResources()
  const customValue = value.startsWith("custom:") ? value : ""
  const knownCustom =
    customValue && customFields.some((f) => `custom:${f.id}` === customValue)
  return (
    <select
      value={value || "name"}
      onChange={(e) => onChange(e.target.value)}
      className={SELECT_CLASS}
    >
      <option value="name">{t("contactFieldName")}</option>
      <option value="email">{t("contactFieldEmail")}</option>
      <option value="company">{t("contactFieldCompany")}</option>
      {customFields.length > 0 && (
        <optgroup label={t("customFieldsGroup")}>
          {customFields.map((f) => (
            <option key={f.id} value={`custom:${f.id}`}>
              {f.field_name}
            </option>
          ))}
        </optgroup>
      )}
      {customValue && !knownCustom && (
        <option value={customValue}>{t("unknownFieldOption", { value: customValue })}</option>
      )}
    </select>
  )
}

/** Agent dropdown by name, storing the member's user_id. Falls back to
 *  a raw id input when the member list is unavailable. */
function AgentSelect({
  value,
  onChange,
}: {
  value: string
  onChange: (v: string) => void
}) {
  const t = useTranslations("automations.builder")
  const { members } = useResources()
  if (members.length === 0) {
    return (
      <Input
        placeholder={t("agentIdPlaceholder")}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="bg-muted text-foreground"
      />
    )
  }
  const selected = members.find((m) => m.user_id === value)
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={SELECT_CLASS}
    >
      <option value="">{t("selectAgent")}</option>
      {members.map((m) => (
        <option key={m.user_id} value={m.user_id}>
          {m.full_name || m.email || m.user_id}
        </option>
      ))}
      {value && !selected && (
        <option value={value}>{t("unknownAgentOption", { value })}</option>
      )}
    </select>
  )
}

/** Template dropdown showing approved templates by name + language,
 *  storing both template_name and language. Falls back to manual name +
 *  language inputs when no approved templates are synced yet. */
function SendTemplateFields({
  templateName,
  language,
  onChange,
}: {
  templateName: string
  language: string
  onChange: (patch: { template_name: string; language: string }) => void
}) {
  const t = useTranslations("automations.builder")
  const { templates } = useResources()

  if (templates.length === 0) {
    return (
      <>
        <FieldBlock label={t("templateNameLabel")}>
          <Input
            value={templateName}
            onChange={(e) =>
              onChange({ template_name: e.target.value, language })
            }
            className="bg-muted text-foreground"
          />
        </FieldBlock>
        <FieldBlock label={t("templateLanguageLabel")}>
          <Input
            value={language}
            onChange={(e) =>
              onChange({ template_name: templateName, language: e.target.value })
            }
            className="bg-muted text-foreground"
          />
        </FieldBlock>
      </>
    )
  }

  // Encode name + language in the option value so two templates that
  // share a name across languages stay distinct.
  const toValue = (name: string, lang: string) => `${name}::${lang}`
  const current = templateName ? toValue(templateName, language) : ""
  const hasMatch = templates.some(
    (tpl) => toValue(tpl.name, tpl.language ?? "en_US") === current,
  )

  return (
    <FieldBlock label={t("templateLabel")}>
      <select
        value={current}
        onChange={(e) => {
          const [name, lang] = e.target.value.split("::")
          onChange({ template_name: name ?? "", language: lang ?? "" })
        }}
        className={SELECT_CLASS}
      >
        <option value="">{t("selectTemplate")}</option>
        {templates.map((tpl) => {
          const lang = tpl.language ?? "en_US"
          return (
            <option key={tpl.id} value={toValue(tpl.name, lang)}>
              {tpl.name} ({lang})
            </option>
          )
        })}
        {current && !hasMatch && (
          <option value={current}>
            {t("notInApprovedList", { name: templateName, language: language || t("unknownLabel") })}
          </option>
        )}
      </select>
    </FieldBlock>
  )
}

/** Pipeline stage dropdown, grouped by pipeline name. Falls back to a
 *  raw id input when no pipelines/stages exist yet. */
function StageSelect({
  value,
  onChange,
}: {
  value: string
  onChange: (v: string) => void
}) {
  const t = useTranslations("automations.builder")
  const { pipelines, stages } = useResources()
  if (stages.length === 0) {
    return (
      <Input
        placeholder={t("stageIdPlaceholder")}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="bg-muted text-foreground"
      />
    )
  }
  const selected = stages.find((s) => s.id === value)
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} className={SELECT_CLASS}>
      <option value="">{t("selectStage")}</option>
      {pipelines.map((p) => {
        const pipelineStages = stages
          .filter((s) => s.pipeline_id === p.id)
          .sort((a, b) => a.position - b.position)
        if (pipelineStages.length === 0) return null
        return (
          <optgroup key={p.id} label={p.name}>
            {pipelineStages.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </optgroup>
        )
      })}
      {value && !selected && (
        <option value={value}>{t("unknownStageOption", { value })}</option>
      )}
    </select>
  )
}

/** Other-automation dropdown for the "start_automation" step. Falls
 *  back to a raw id input when no automations exist yet. */
function AutomationSelect({
  value,
  onChange,
}: {
  value: string
  onChange: (v: string) => void
}) {
  const t = useTranslations("automations.builder")
  const { automations } = useResources()
  if (automations.length === 0) {
    return (
      <Input
        placeholder={t("automationIdPlaceholder")}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="bg-muted text-foreground"
      />
    )
  }
  const selected = automations.find((a) => a.id === value)
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} className={SELECT_CLASS}>
      <option value="">{t("selectAutomation")}</option>
      {automations.map((a) => (
        <option key={a.id} value={a.id}>
          {a.name}
        </option>
      ))}
      {value && !selected && (
        <option value={value}>{t("unknownAutomationOption", { value })}</option>
      )}
    </select>
  )
}

// ------------------------------------------------------------
// Main builder component
// ------------------------------------------------------------

export function AutomationBuilder({ initial }: { initial: BuilderInitial }) {
  const t = useTranslations("automations.builder")
  const router = useRouter()
  const isEditing = !!initial.id
  const [state, setState] = useState<BuilderInitial>(initial)
  const [saving, setSaving] = useState(false)
  const [expandedId, setExpandedId] = useState<string | null>(null)

  function patchTop<K extends keyof BuilderInitial>(key: K, value: BuilderInitial[K]) {
    setState((s) => ({ ...s, [key]: value }))
  }

  // --- Step tree mutations (immutable) ---

  function updateStep(path: StepPath, updater: (s: BuilderStep) => BuilderStep) {
    setState((s) => ({ ...s, steps: mapAtPath(s.steps, path, updater) }))
  }

  function addStepAt(parent: ParentScope, index: number, type: AutomationStepType) {
    const node: BuilderStep = {
      cid: cid(),
      step_type: type,
      step_config: blankConfig(type),
      branches: type === "condition" || type === "randomizer" ? { yes: [], no: [] } : undefined,
    }
    setState((s) => ({ ...s, steps: insertAt(s.steps, parent, index, node) }))
    setExpandedId(node.cid)
  }

  function deleteStepAt(path: StepPath) {
    setState((s) => ({ ...s, steps: removeAt(s.steps, path) }))
  }

  function moveStepAt(path: StepPath, direction: -1 | 1) {
    setState((s) => ({ ...s, steps: moveAt(s.steps, path, direction) }))
  }

  async function save() {
    setSaving(true)
    try {
      const payload = {
        name: state.name || t("untitledAutomation"),
        description: state.description || null,
        trigger_type: state.trigger_type,
        trigger_config: state.trigger_config,
        is_active: state.is_active,
        steps: toApiSteps(state.steps),
      }

      const res = isEditing
        ? await fetch(`/api/automations/${initial.id}`, {
            method: "PATCH",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(payload),
          })
        : await fetch(`/api/automations`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(payload),
          })

      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        // If the server blocked activation with validation issues,
        // surface the first concrete problem so the user can fix it
        // without opening DevTools for the full array.
        const firstIssue: { path?: string; message?: string } | undefined =
          body?.issues?.[0]
        if (firstIssue?.message) {
          toast.error(firstIssue.message, {
            description: firstIssue.path ? t("atPath", { path: firstIssue.path }) : undefined,
          })
        } else {
          toast.error(body?.error ?? t("saveFailed"))
        }
        return
      }
      toast.success(isEditing ? t("automationSaved") : t("automationCreated"))
      if (!isEditing && body?.automation?.id) {
        router.replace(`/automations/${body.automation.id}/edit`)
      }
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 flex flex-col bg-background">
      {/* Top bar. At sub-sm widths the "Active" label is hidden and the
          switch moves to the right of the save button, so the name input
          gets maximum width. */}
      <header className="flex flex-shrink-0 items-center gap-2 border-b border-border bg-card/80 px-3 py-3 sm:gap-3 sm:px-4">
        <button
          type="button"
          onClick={() => router.push("/automations")}
          className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          aria-label={t("backToAutomations")}
        >
          <ArrowLeft className="h-4 w-4" />
        </button>
        <input
          value={state.name}
          onChange={(e) => patchTop("name", e.target.value)}
          placeholder={t("untitledAutomation")}
          className="min-w-0 flex-1 rounded-md bg-transparent px-2 py-1 text-sm font-semibold text-foreground placeholder:text-muted-foreground focus:bg-muted focus:outline-none sm:text-base"
        />
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span className="hidden sm:inline">{t("active")}</span>
          <Switch
            checked={state.is_active}
            onCheckedChange={(v) => patchTop("is_active", !!v)}
            aria-label={t("active")}
          />
        </div>
        <Button
          onClick={save}
          disabled={saving}
          className="bg-primary text-primary-foreground hover:bg-primary/90"
        >
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          {isEditing ? t("save") : t("saveDraft")}
        </Button>
      </header>

      {/* Canvas */}
      <div className="relative flex-1 overflow-y-auto">
        <div className="absolute inset-0 bg-[radial-gradient(circle,var(--border)_1px,transparent_1px)] [background-size:20px_20px] pointer-events-none" />
        <div className="relative mx-auto flex max-w-2xl flex-col items-center gap-0 px-4 py-10">
          <ResourcesProvider>
            <TriggerCard
              type={state.trigger_type}
              config={state.trigger_config}
              onTypeChange={(t) => patchTop("trigger_type", t)}
              onConfigChange={(c) => patchTop("trigger_config", c)}
            />
            <StepList
              steps={state.steps}
              parentPath={[]}
              expandedId={expandedId}
              setExpandedId={setExpandedId}
              updateStep={updateStep}
              addStepAt={addStepAt}
              deleteStepAt={deleteStepAt}
              moveStepAt={moveStepAt}
            />
          </ResourcesProvider>
        </div>
      </div>
    </div>
  )
}

// ------------------------------------------------------------
// Trigger card
// ------------------------------------------------------------

function TriggerCard({
  type,
  config,
  onTypeChange,
  onConfigChange,
}: {
  type: AutomationTriggerType
  config: Record<string, unknown>
  onTypeChange: (t: AutomationTriggerType) => void
  onConfigChange: (c: Record<string, unknown>) => void
}) {
  const t = useTranslations("automations.builder")
  const [open, setOpen] = useState(false)
  const activeOption = TRIGGER_OPTIONS.find((o) => o.value === type)
  return (
    // Card width: full on mobile, fixed 320px on sm+. The canvas wrapper
    // (max-w-2xl + px-4) keeps this tidy on tablet/desktop.
    <div className="z-10 w-full max-w-[320px] sm:w-80">
      <div className="rounded-lg border border-border border-l-4 border-l-blue-500 bg-card shadow-lg">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex w-full items-center gap-3 px-4 py-3 text-left"
        >
          <div className="flex h-8 w-8 items-center justify-center rounded-md bg-blue-500/10 text-blue-400">
            <Zap className="h-4 w-4" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-[11px] uppercase tracking-wide text-blue-300">{t("trigger")}</div>
            <div className="truncate text-sm font-medium text-foreground">
              {activeOption ? t(activeOption.labelKey) : type}
            </div>
          </div>
          <ChevronDown
            className={cn("h-4 w-4 text-muted-foreground transition-transform", open && "rotate-180")}
          />
        </button>
        {open && (
          <div className="space-y-3 border-t border-border px-4 py-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">
                {t("triggerType")}
              </label>
              <select
                value={type}
                onChange={(e) => onTypeChange(e.target.value as AutomationTriggerType)}
                className="w-full rounded-md border border-border bg-muted px-2 py-1.5 text-sm text-foreground focus:border-primary focus:outline-none"
              >
                {TRIGGER_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {t(o.labelKey)}
                  </option>
                ))}
              </select>
              <p className="mt-1 text-[11px] text-muted-foreground">
                {activeOption ? t(activeOption.hintKey) : ""}
              </p>
            </div>
            {type === "keyword_match" && (
              <KeywordMatchConfig
                config={config as unknown as KeywordMatchTriggerConfig}
                onChange={onConfigChange}
              />
            )}
            {type === "tag_added" && (
              <div>
                <label className="mb-1 block text-xs font-medium text-muted-foreground">
                  {t("tagLabel")}
                </label>
                <TagSelect
                  value={(config.tag_id as string) ?? ""}
                  onChange={(v) => onConfigChange({ ...config, tag_id: v })}
                />
              </div>
            )}
            {type === "time_based" && (
              <Input
                placeholder={t("cronOrTimePlaceholder")}
                value={(config.schedule as string) ?? ""}
                onChange={(e) =>
                  onConfigChange({ ...config, schedule: e.target.value })
                }
                className="bg-muted text-foreground"
              />
            )}
            {type === "deal_stage_changed" && (
              <>
                <FieldBlock label={t("fromStageLabel")}>
                  <StageSelect
                    value={(config.from_stage_id as string) ?? ""}
                    onChange={(v) => onConfigChange({ ...config, from_stage_id: v })}
                  />
                </FieldBlock>
                <FieldBlock label={t("toStageLabel")}>
                  <StageSelect
                    value={(config.to_stage_id as string) ?? ""}
                    onChange={(v) => onConfigChange({ ...config, to_stage_id: v })}
                  />
                </FieldBlock>
              </>
            )}
            {type === "button_clicked" && (
              <FieldBlock label={t("buttonTextLabel")}>
                <Input
                  placeholder={t("buttonTextPlaceholder")}
                  value={(config.button_text as string) ?? ""}
                  onChange={(e) => onConfigChange({ ...config, button_text: e.target.value })}
                  className="bg-muted text-foreground"
                />
              </FieldBlock>
            )}
            {type === "nps_received" && (
              <FieldBlock label={t("minRatingLabel")}>
                <Input
                  type="number"
                  min={1}
                  max={5}
                  placeholder={t("minRatingPlaceholder")}
                  value={(config.min_rating as number) ?? ""}
                  onChange={(e) =>
                    onConfigChange({
                      ...config,
                      min_rating: e.target.value === "" ? undefined : Number(e.target.value),
                    })
                  }
                  className="bg-muted text-foreground"
                />
              </FieldBlock>
            )}
            {type === "inactivity" && (
              <FieldBlock label={t("inactivityHoursLabel")}>
                <Input
                  type="number"
                  min={1}
                  value={(config.hours as number) ?? 24}
                  onChange={(e) =>
                    onConfigChange({ ...config, hours: Math.max(1, Number(e.target.value)) })
                  }
                  className="bg-muted text-foreground"
                />
              </FieldBlock>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

function KeywordMatchConfig({
  config,
  onChange,
}: {
  config: KeywordMatchTriggerConfig
  onChange: (c: Record<string, unknown>) => void
}) {
  const t = useTranslations("automations.builder")
  const keywords = config?.keywords ?? []
  // Keep a local draft string so the comma and trailing space aren't
  // stripped on every keystroke (which made multi-word, comma-separated
  // entry like "SEO, search engine optimization" impossible to type).
  // We only parse into the keywords array on blur, then re-display the
  // cleaned, rejoined form. Seeded once on mount; this component remounts
  // when the trigger type changes, so the seed stays in sync.
  const [draft, setDraft] = useState(keywords.join("\n"))

  // Persist the default the <select> displays. The dropdown falls back to
  // "contains" for display, but leaving it untouched would otherwise omit
  // match_type from the saved config — and activation validation then
  // rejected it (trigger.match_type). Seed once on mount; the component
  // remounts when the trigger type changes, matching the keywords draft.
  useEffect(() => {
    if (config?.match_type == null) {
      onChange({ ...config, match_type: "contains" })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function commit() {
    const parsed = draft
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean)
    setDraft(parsed.join("\n"))
    onChange({ ...config, keywords: parsed })
  }

  return (
    <div className="space-y-2">
      <div>
        <label className="mb-1 block text-xs font-medium text-muted-foreground">
          {t("keywordsLabel")}
        </label>
        <Textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          placeholder={t("keywordsPlaceholder")}
          className="min-h-20 bg-muted text-foreground"
        />
      </div>
      <div>
        <label className="mb-1 block text-xs font-medium text-muted-foreground">
          {t("matchType")}
        </label>
        <select
          value={config?.match_type ?? "contains"}
          onChange={(e) => onChange({ ...config, match_type: e.target.value as "exact" | "contains" })}
          className="w-full rounded-md border border-border bg-muted px-2 py-1.5 text-sm text-foreground focus:outline-none"
        >
          <option value="contains">{t("contains")}</option>
          <option value="exact">{t("exact")}</option>
        </select>
      </div>
    </div>
  )
}

// ------------------------------------------------------------
// Step list + card + connectors
// ------------------------------------------------------------

type ParentScope =
  | { kind: "root" }
  | { kind: "branch"; parentCid: string; branch: "yes" | "no" }

type StepPath = (
  | { kind: "root"; index: number }
  | { kind: "branch"; parentCid: string; branch: "yes" | "no"; index: number }
)[]

interface StepListProps {
  steps: BuilderStep[]
  parentPath: StepPath
  expandedId: string | null
  setExpandedId: (id: string | null) => void
  updateStep: (path: StepPath, updater: (s: BuilderStep) => BuilderStep) => void
  addStepAt: (parent: ParentScope, index: number, type: AutomationStepType) => void
  deleteStepAt: (path: StepPath) => void
  moveStepAt: (path: StepPath, direction: -1 | 1) => void
}

function StepList(props: StepListProps) {
  const { steps, parentPath, ...rest } = props
  const parentScope: ParentScope =
    parentPath.length === 0
      ? { kind: "root" }
      : (() => {
          const last = parentPath[parentPath.length - 1]
          if (last.kind !== "branch") return { kind: "root" } as const
          return { kind: "branch", parentCid: last.parentCid, branch: last.branch } as const
        })()

  return (
    <div className="flex flex-col items-center">
      <AddButton onPick={(t) => props.addStepAt(parentScope, 0, t)} />
      {steps.map((step, idx) => (
        <StepRenderer
          key={step.cid}
          step={step}
          index={idx}
          total={steps.length}
          parentScope={parentScope}
          parentPath={parentPath}
          {...rest}
        />
      ))}
    </div>
  )
}

function StepRenderer({
  step,
  index,
  total,
  parentScope,
  parentPath,
  ...props
}: {
  step: BuilderStep
  index: number
  total: number
  parentScope: ParentScope
  parentPath: StepPath
} & Omit<StepListProps, "steps" | "parentPath">) {
  const t = useTranslations("automations.builder")
  const resources = useResources()
  const path: StepPath = [
    ...parentPath,
    parentScope.kind === "root"
      ? { kind: "root", index }
      : { kind: "branch", parentCid: parentScope.parentCid, branch: parentScope.branch, index },
  ]
  const meta = STEP_META[step.step_type]
  const Icon = meta.icon
  const expanded = props.expandedId === step.cid
  const isCondition = step.step_type === "condition"
  const isRandomizer = step.step_type === "randomizer"
  const hasBranches = isCondition || isRandomizer
  // Card widths on mobile fill the full canvas column (max-w-2xl px-4
  // still keeps them reasonable). On sm+ the original fixed widths
  // come back so the flow visual stays recognisable.
  const width = hasBranches
    ? "w-full max-w-[400px] sm:w-[400px]"
    : "w-full max-w-[320px] sm:w-80"

  return (
    <>
      <div className={cn("z-10 flex flex-col", width)}>
        <div
          className={cn(
            "rounded-lg border border-border border-l-4 bg-card shadow-lg",
            meta.border,
          )}
        >
          <button
            type="button"
            onClick={() => props.setExpandedId(expanded ? null : step.cid)}
            className="flex w-full items-center gap-3 px-4 py-3 text-left"
          >
            <GripVertical className="h-4 w-4 flex-shrink-0 text-muted-foreground" aria-hidden />
            <div className="flex h-8 w-8 items-center justify-center rounded-md bg-muted text-muted-foreground">
              <Icon className="h-4 w-4" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
                {isCondition
                  ? t("condition")
                  : isRandomizer
                  ? t("split")
                  : step.step_type === "wait"
                  ? t("wait")
                  : t("action")}
              </div>
              <div className="truncate text-sm font-medium text-foreground">{t(meta.labelKey)}</div>
              <div className="truncate text-[11px] text-muted-foreground">{previewFor(step, t, resources)}</div>
            </div>
            <ChevronDown
              className={cn("h-4 w-4 text-muted-foreground transition-transform", expanded && "rotate-180")}
            />
          </button>
          {expanded && (
            <div className="border-t border-border px-4 py-3">
              <StepEditor
                step={step}
                onChange={(next) => props.updateStep(path, () => next)}
              />
              <div className="mt-3 flex items-center justify-between gap-2 border-t border-border pt-3">
                <div className="flex gap-1">
                  <Button
                    variant="ghost"
                    size="icon"
                    disabled={index === 0}
                    aria-label={t("moveUp")}
                    onClick={() => props.moveStepAt(path, -1)}
                  >
                    <ArrowUp className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    disabled={index === total - 1}
                    aria-label={t("moveDown")}
                    onClick={() => props.moveStepAt(path, 1)}
                  >
                    <ArrowDown className="h-4 w-4" />
                  </Button>
                </div>
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={() => props.deleteStepAt(path)}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  {t("delete")}
                </Button>
              </div>
            </div>
          )}
        </div>

        {hasBranches && (
          <ConditionBranches step={step} parentPath={path} {...props} />
        )}
      </div>

      {/* A condition/randomizer branches into two paths (rendered above by
          ConditionBranches), so it has no linear "continue" path — adding
          the trailing connector here would produce a spurious third output. */}
      {!hasBranches && (
        <AddButton
          onPick={(t) => props.addStepAt(parentScope, index + 1, t)}
        />
      )}
    </>
  )
}

function ConditionBranches({
  step,
  parentPath,
  ...props
}: {
  step: BuilderStep
  parentPath: StepPath
} & Omit<StepListProps, "steps" | "parentPath">) {
  const t = useTranslations("automations.builder")
  const yes = step.branches?.yes ?? []
  const no = step.branches?.no ?? []
  // Build the child scope by appending a branch marker. The scope the
  // StepList uses is driven by the LAST element of parentPath, so the
  // tail's `index` doesn't matter — it's replaced per child during walks.
  const yesPath: StepPath = [
    ...parentPath,
    { kind: "branch", parentCid: step.cid, branch: "yes", index: 0 },
  ]
  const noPath: StepPath = [
    ...parentPath,
    { kind: "branch", parentCid: step.cid, branch: "no", index: 0 },
  ]
  const isRandomizer = step.step_type === "randomizer"
  const splitPercent = Number((step.step_config as { split_percent?: number }).split_percent ?? 50)
  const yesLabel = isRandomizer ? t("splitBranchA", { percent: splitPercent }) : t("yes")
  const noLabel = isRandomizer ? t("splitBranchB", { percent: 100 - splitPercent }) : t("no")
  return (
    // Stack Yes/No vertically on mobile — two columns at 375px would
    // cram each branch to ~170px which is too narrow for the nested
    // cards. Two-column grid returns on sm+.
    <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
      <BranchColumn label={yesLabel} color="text-primary">
        <StepList {...props} steps={yes} parentPath={yesPath} />
      </BranchColumn>
      <BranchColumn label={noLabel} color="text-rose-400">
        <StepList {...props} steps={no} parentPath={noPath} />
      </BranchColumn>
    </div>
  )
}

function BranchColumn({
  label,
  color,
  children,
}: {
  label: string
  color: string
  children: React.ReactNode
}) {
  return (
    <div className="flex flex-col items-center">
      <div className={cn("mb-2 text-[11px] font-semibold uppercase", color)}>{label}</div>
      {children}
    </div>
  )
}

function AddButton({ onPick }: { onPick: (type: AutomationStepType) => void }) {
  const t = useTranslations("automations.builder")
  return (
    <div className="relative flex flex-col items-center">
      <div className="h-4 w-[2px] bg-border" aria-hidden />
      <DropdownMenu>
        <DropdownMenuTrigger
          className="flex h-8 w-8 items-center justify-center rounded-full border-2 border-dashed border-border bg-background text-muted-foreground transition-colors hover:border-primary hover:bg-primary/10 hover:text-primary data-[popup-open]:border-primary data-[popup-open]:bg-primary/20 data-[popup-open]:text-primary"
          aria-label={t("addStep")}
        >
          <Plus className="h-4 w-4" />
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="start"
          className="max-h-80 min-w-56 overflow-y-auto border-border bg-popover"
        >
          {ADDABLE_STEPS.map((stepType) => {
            const Icon = STEP_META[stepType].icon
            return (
              <DropdownMenuItem key={stepType} onClick={() => onPick(stepType)}>
                <Icon className="h-4 w-4" />
                {t(STEP_META[stepType].labelKey)}
              </DropdownMenuItem>
            )
          })}
        </DropdownMenuContent>
      </DropdownMenu>
      <div className="h-4 w-[2px] bg-border" aria-hidden />
    </div>
  )
}

// ------------------------------------------------------------
// Per-step config editor
// ------------------------------------------------------------

function StepEditor({
  step,
  onChange,
}: {
  step: BuilderStep
  onChange: (s: BuilderStep) => void
}) {
  const t = useTranslations("automations.builder")
  const cfg = step.step_config
  const set = (patch: Record<string, unknown>) =>
    onChange({ ...step, step_config: { ...cfg, ...patch } })

  switch (step.step_type) {
    case "send_message":
      return (
        <FieldBlock label={t("messageText")}>
          <Textarea
            value={(cfg.text as string) ?? ""}
            onChange={(e) => set({ text: e.target.value })}
            placeholder={t("messageTextPlaceholder")}
            className="min-h-24 bg-muted text-foreground"
          />
        </FieldBlock>
      )
    case "send_template":
      return (
        <SendTemplateFields
          templateName={(cfg.template_name as string) ?? ""}
          language={(cfg.language as string) ?? ""}
          onChange={(patch) => set(patch)}
        />
      )
    case "add_tag":
    case "remove_tag":
      return (
        <FieldBlock label={t("tagLabel")}>
          <TagSelect
            value={(cfg.tag_id as string) ?? ""}
            onChange={(v) => set({ tag_id: v })}
          />
        </FieldBlock>
      )
    case "assign_conversation":
      return (
        <>
          <FieldBlock label={t("modeLabel")}>
            <select
              value={(cfg.mode as string) ?? "round_robin"}
              onChange={(e) => set({ mode: e.target.value })}
              className="w-full rounded-md border border-border bg-muted px-2 py-1.5 text-sm text-foreground"
            >
              <option value="round_robin">{t("roundRobin")}</option>
              <option value="specific">{t("specificAgent")}</option>
            </select>
          </FieldBlock>
          {cfg.mode === "specific" && (
            <FieldBlock label={t("agentLabel")}>
              <AgentSelect
                value={(cfg.agent_id as string) ?? ""}
                onChange={(v) => set({ agent_id: v })}
              />
            </FieldBlock>
          )}
        </>
      )
    case "unassign_agent":
      return <p className="text-xs text-muted-foreground">{t("unassignAgentHint")}</p>
    case "update_contact_field":
      return (
        <>
          <FieldBlock label={t("fieldLabel")}>
            <ContactFieldSelect
              value={(cfg.field as string) ?? "name"}
              onChange={(v) => set({ field: v })}
            />
          </FieldBlock>
          <FieldBlock label={t("valueLabel")}>
            <Input
              value={(cfg.value as string) ?? ""}
              onChange={(e) => set({ value: e.target.value })}
              placeholder={t("valueVariablePlaceholder")}
              className="bg-muted text-foreground"
            />
          </FieldBlock>
        </>
      )
    case "create_deal":
      return (
        <>
          <FieldBlock label={t("pipelineIdLabel")}>
            <Input
              value={(cfg.pipeline_id as string) ?? ""}
              onChange={(e) => set({ pipeline_id: e.target.value })}
              placeholder={t("pipelineIdPlaceholder")}
              className="bg-muted text-foreground"
            />
          </FieldBlock>
          <FieldBlock label={t("stageIdLabel")}>
            <Input
              value={(cfg.stage_id as string) ?? ""}
              onChange={(e) => set({ stage_id: e.target.value })}
              placeholder={t("stageIdPlaceholder")}
              className="bg-muted text-foreground"
            />
          </FieldBlock>
          <FieldBlock label={t("titleLabel")}>
            <Input
              value={(cfg.title as string) ?? ""}
              onChange={(e) => set({ title: e.target.value })}
              placeholder={t("titlePlaceholder")}
              className="bg-muted text-foreground"
            />
          </FieldBlock>
          <FieldBlock label={t("valueLabel")}>
            <Input
              type="number"
              value={(cfg.value as number) ?? 0}
              onChange={(e) => set({ value: Number(e.target.value) })}
              className="bg-muted text-foreground"
            />
          </FieldBlock>
        </>
      )
    case "update_deal_stage":
      return (
        <FieldBlock label={t("stageLabel")}>
          <StageSelect
            value={(cfg.stage_id as string) ?? ""}
            onChange={(v) => set({ stage_id: v })}
          />
        </FieldBlock>
      )
    case "update_deal_value":
      return (
        <FieldBlock label={t("valueLabel")}>
          <Input
            type="number"
            value={(cfg.value as number) ?? 0}
            onChange={(e) => set({ value: Number(e.target.value) })}
            className="bg-muted text-foreground"
          />
        </FieldBlock>
      )
    case "mark_deal_won":
      return <p className="text-xs text-muted-foreground">{t("markDealWonHint")}</p>
    case "mark_deal_lost":
      return (
        <FieldBlock label={t("reasonLabel")}>
          <Input
            value={(cfg.reason as string) ?? ""}
            onChange={(e) => set({ reason: e.target.value })}
            placeholder={t("reasonPlaceholder")}
            className="bg-muted text-foreground"
          />
        </FieldBlock>
      )
    case "wait":
      return (
        <div className="grid grid-cols-2 gap-2">
          <FieldBlock label={t("amountLabel")}>
            <Input
              type="number"
              min={1}
              value={(cfg.amount as number) ?? 1}
              onChange={(e) => set({ amount: Math.max(1, Number(e.target.value)) })}
              className="bg-muted text-foreground"
            />
          </FieldBlock>
          <FieldBlock label={t("unitLabel")}>
            <select
              value={(cfg.unit as string) ?? "hours"}
              onChange={(e) => set({ unit: e.target.value })}
              className="w-full rounded-md border border-border bg-muted px-2 py-1.5 text-sm text-foreground"
            >
              <option value="minutes">{t("minutes")}</option>
              <option value="hours">{t("hours")}</option>
              <option value="days">{t("days")}</option>
            </select>
          </FieldBlock>
        </div>
      )
    case "randomizer":
      return (
        <FieldBlock label={t("splitPercentLabel")}>
          <Input
            type="number"
            min={0}
            max={100}
            value={(cfg.split_percent as number) ?? 50}
            onChange={(e) =>
              set({ split_percent: Math.min(100, Math.max(0, Number(e.target.value))) })
            }
            className="bg-muted text-foreground"
          />
          <p className="mt-1 text-[11px] text-muted-foreground">{t("splitPercentHint")}</p>
        </FieldBlock>
      )
    case "start_automation":
      return (
        <FieldBlock label={t("automationLabel")}>
          <AutomationSelect
            value={(cfg.automation_id as string) ?? ""}
            onChange={(v) => set({ automation_id: v })}
          />
        </FieldBlock>
      )
    case "stop_automation":
      return <p className="text-xs text-muted-foreground">{t("stopAutomationHint")}</p>
    case "open_conversation":
      return <p className="text-xs text-muted-foreground">{t("openConversationHint")}</p>
    case "set_conversation_pending":
      return <p className="text-xs text-muted-foreground">{t("setPendingHint")}</p>
    case "condition":
      return (
        <>
          <FieldBlock label={t("subjectLabel")}>
            <select
              value={(cfg.subject as string) ?? "tag_presence"}
              onChange={(e) => set({ subject: e.target.value })}
              className="w-full rounded-md border border-border bg-muted px-2 py-1.5 text-sm text-foreground"
            >
              <option value="tag_presence">{t("tagPresence")}</option>
              <option value="contact_field">{t("contactFieldSubject")}</option>
              <option value="message_content">{t("messageContent")}</option>
              <option value="time_of_day">{t("timeOfDay")}</option>
            </select>
          </FieldBlock>
          <FieldBlock label={t("operandLabel")}>
            <Input
              placeholder={
                cfg.subject === "time_of_day"
                  ? t("operandTimePlaceholder")
                  : cfg.subject === "contact_field"
                  ? t("operandContactFieldPlaceholder")
                  : cfg.subject === "tag_presence"
                  ? t("operandTagPlaceholder")
                  : ""
              }
              value={(cfg.operand as string) ?? ""}
              onChange={(e) => set({ operand: e.target.value })}
              className="bg-muted text-foreground"
            />
          </FieldBlock>
          {(cfg.subject === "contact_field" || cfg.subject === "message_content") && (
            <FieldBlock label={t("valueLabel")}>
              <Input
                value={(cfg.value as string) ?? ""}
                onChange={(e) => set({ value: e.target.value })}
                className="bg-muted text-foreground"
              />
            </FieldBlock>
          )}
        </>
      )
    case "send_webhook":
      return (
        <>
          <FieldBlock label={t("urlLabel")}>
            <Input
              value={(cfg.url as string) ?? ""}
              onChange={(e) => set({ url: e.target.value })}
              className="bg-muted text-foreground"
            />
          </FieldBlock>
          <FieldBlock label={t("bodyTemplateLabel")}>
            <Textarea
              value={(cfg.body_template as string) ?? ""}
              onChange={(e) => set({ body_template: e.target.value })}
              className="min-h-20 bg-muted font-mono text-xs text-foreground"
            />
          </FieldBlock>
        </>
      )
    case "close_conversation":
      return (
        <p className="text-xs text-muted-foreground">
          {t("closeConversationHint")}
        </p>
      )
    default:
      return null
  }
}

function FieldBlock({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <div className="mb-2 last:mb-0">
      <label className="mb-1 block text-xs font-medium text-muted-foreground">{label}</label>
      {children}
    </div>
  )
}

function previewFor(
  step: BuilderStep,
  t: (key: string, values?: Record<string, string | number>) => string,
  resources: AutomationResources,
): string {
  const cfg = step.step_config
  switch (step.step_type) {
    case "send_message":
      return (cfg.text as string) || t("noTextYet")
    case "send_template":
      return (cfg.template_name as string) || t("chooseTemplate")
    case "add_tag":
    case "remove_tag": {
      const tag = resources.tags.find((tg) => tg.id === cfg.tag_id)
      return tag ? tag.name : t("selectTag")
    }
    case "assign_conversation": {
      if (cfg.mode === "round_robin") return t("roundRobin")
      const member = resources.members.find((m) => m.user_id === cfg.agent_id)
      return member
        ? t("assignToPreview", { name: member.full_name || member.email || "?" })
        : t("selectAgent")
    }
    case "unassign_agent":
      return t("unassignAgentHint")
    case "update_contact_field":
      return cfg.field ? t("updateFieldPreview", { field: String(cfg.field) }) : ""
    case "create_deal":
      return (cfg.title as string) || t("titlePlaceholder")
    case "update_deal_stage": {
      const stage = resources.stages.find((s) => s.id === cfg.stage_id)
      return stage
        ? t("moveToStagePreview", { stage: stage.name })
        : t("selectStage")
    }
    case "update_deal_value":
      return t("updateValuePreview", { value: Number(cfg.value ?? 0) })
    case "mark_deal_won":
      return t("markDealWonHint")
    case "mark_deal_lost":
      return (cfg.reason as string) || t("markDealLostHint")
    case "wait":
      return `${cfg.amount ?? "?"} ${cfg.unit ?? ""}`
    case "condition":
      return t("whenSubject", { subject: String(cfg.subject ?? "?") })
    case "randomizer": {
      const pct = Number(cfg.split_percent ?? 50)
      return t("splitPreview", { percentA: pct, percentB: 100 - pct })
    }
    case "start_automation": {
      const target = resources.automations.find((a) => a.id === cfg.automation_id)
      return target ? target.name : t("selectAutomation")
    }
    case "stop_automation":
      return t("stopAutomationHint")
    case "send_webhook":
      return (cfg.url as string) || t("noUrl")
    case "open_conversation":
      return t("openConversationHint")
    case "set_conversation_pending":
      return t("setPendingHint")
    case "close_conversation":
      return t("closeConversationHint")
    default:
      return ""
  }
}

// ------------------------------------------------------------
// Tree mutation helpers
// ------------------------------------------------------------

function insertAt(
  steps: BuilderStep[],
  parent: ParentScope,
  index: number,
  node: BuilderStep,
): BuilderStep[] {
  if (parent.kind === "root") {
    const copy = [...steps]
    copy.splice(index, 0, node)
    return copy
  }
  return steps.map((s) => {
    if (s.cid !== parent.parentCid || !s.branches) return s
    const list = [...s.branches[parent.branch]]
    list.splice(index, 0, node)
    return { ...s, branches: { ...s.branches, [parent.branch]: list } }
  })
}

function mapAtPath(
  steps: BuilderStep[],
  path: StepPath,
  updater: (s: BuilderStep) => BuilderStep,
): BuilderStep[] {
  if (path.length === 0) return steps
  const head = path[0]
  const rest = path.slice(1)

  if (head.kind === "root") {
    return steps.map((s, i) => {
      if (i !== head.index) return s
      return rest.length === 0
        ? updater(s)
        : { ...s, branches: walkBranches(s.branches, rest, updater) }
    })
  }
  return steps.map((s) => {
    if (s.cid !== head.parentCid || !s.branches) return s
    const bucket = s.branches[head.branch]
    const updated = bucket.map((child, i) => {
      if (i !== head.index) return child
      return rest.length === 0
        ? updater(child)
        : { ...child, branches: walkBranches(child.branches, rest, updater) }
    })
    return { ...s, branches: { ...s.branches, [head.branch]: updated } }
  })
}

function walkBranches(
  branches: BuilderStep["branches"],
  path: StepPath,
  updater: (s: BuilderStep) => BuilderStep,
): BuilderStep["branches"] {
  if (!branches) return branches
  const head = path[0]
  if (head.kind !== "branch") return branches
  const bucket = branches[head.branch]
  const rest = path.slice(1)
  const updated = bucket.map((child, i) => {
    if (i !== head.index) return child
    return rest.length === 0
      ? updater(child)
      : { ...child, branches: walkBranches(child.branches, rest, updater) }
  })
  return { ...branches, [head.branch]: updated }
}

function removeAt(steps: BuilderStep[], path: StepPath): BuilderStep[] {
  if (path.length === 0) return steps
  const head = path[0]
  const rest = path.slice(1)
  if (head.kind === "root") {
    if (rest.length === 0) return steps.filter((_, i) => i !== head.index)
    return steps.map((s, i) =>
      i !== head.index ? s : { ...s, branches: removeFromBranches(s.branches, rest) },
    )
  }
  return steps.map((s) => {
    if (s.cid !== head.parentCid || !s.branches) return s
    const bucket = s.branches[head.branch]
    const next =
      rest.length === 0
        ? bucket.filter((_, i) => i !== head.index)
        : bucket.map((child, i) =>
            i !== head.index
              ? child
              : { ...child, branches: removeFromBranches(child.branches, rest) },
          )
    return { ...s, branches: { ...s.branches, [head.branch]: next } }
  })
}

function removeFromBranches(
  branches: BuilderStep["branches"],
  path: StepPath,
): BuilderStep["branches"] {
  if (!branches) return branches
  const head = path[0]
  if (head.kind !== "branch") return branches
  const rest = path.slice(1)
  const bucket = branches[head.branch]
  const next =
    rest.length === 0
      ? bucket.filter((_, i) => i !== head.index)
      : bucket.map((child, i) =>
          i !== head.index
            ? child
            : { ...child, branches: removeFromBranches(child.branches, rest) },
        )
  return { ...branches, [head.branch]: next }
}

function moveAt(
  steps: BuilderStep[],
  path: StepPath,
  direction: -1 | 1,
): BuilderStep[] {
  if (path.length === 0) return steps
  const head = path[0]
  const rest = path.slice(1)
  const swap = <T,>(arr: T[], i: number) => {
    const j = i + direction
    if (j < 0 || j >= arr.length) return arr
    const copy = [...arr]
    ;[copy[i], copy[j]] = [copy[j], copy[i]]
    return copy
  }
  if (head.kind === "root") {
    if (rest.length === 0) return swap(steps, head.index)
    return steps.map((s, i) =>
      i !== head.index ? s : { ...s, branches: moveInBranches(s.branches, rest, direction) },
    )
  }
  return steps.map((s) => {
    if (s.cid !== head.parentCid || !s.branches) return s
    const bucket = s.branches[head.branch]
    const next = rest.length === 0 ? swap(bucket, head.index) : bucket
    return { ...s, branches: { ...s.branches, [head.branch]: next } }
  })
}

function moveInBranches(
  branches: BuilderStep["branches"],
  path: StepPath,
  direction: -1 | 1,
): BuilderStep["branches"] {
  if (!branches) return branches
  const head = path[0]
  if (head.kind !== "branch") return branches
  const rest = path.slice(1)
  const bucket = branches[head.branch]
  const swap = <T,>(arr: T[], i: number) => {
    const j = i + direction
    if (j < 0 || j >= arr.length) return arr
    const copy = [...arr]
    ;[copy[i], copy[j]] = [copy[j], copy[i]]
    return copy
  }
  const next = rest.length === 0 ? swap(bucket, head.index) : bucket
  return { ...branches, [head.branch]: next }
}

// ------------------------------------------------------------
// Serialize builder tree → API payload (flattened shape)
// ------------------------------------------------------------

interface ApiStep {
  step_type: string
  step_config: Record<string, unknown>
  branches?: { yes?: ApiStep[]; no?: ApiStep[] }
}

export function toApiSteps(steps: BuilderStep[]): ApiStep[] {
  return steps.map((s) => ({
    step_type: s.step_type,
    step_config: s.step_config,
    branches: s.branches
      ? { yes: toApiSteps(s.branches.yes), no: toApiSteps(s.branches.no) }
      : undefined,
  }))
}

/**
 * Convert server-returned step tree (from loadStepsTree) into the
 * builder-local shape with client ids.
 */
export interface ServerStepNode {
  id: string
  step_type: string
  step_config: Record<string, unknown>
  branches: { yes: ServerStepNode[]; no: ServerStepNode[] }
}

export function fromServerSteps(nodes: ServerStepNode[]): BuilderStep[] {
  return nodes.map((n) => ({
    cid: cid(),
    step_type: n.step_type as AutomationStepType,
    step_config: n.step_config ?? {},
    branches:
      n.step_type === "condition" || n.step_type === "randomizer"
        ? {
            yes: fromServerSteps(n.branches?.yes ?? []),
            no: fromServerSteps(n.branches?.no ?? []),
          }
        : undefined,
  }))
}
