export interface TourStepDef {
  id: string;
  /** Path (+ optional `?search`) the app must be on for this step's
   *  element to exist. Compared against `location.pathname + location.search`
   *  — <OnboardingTourProvider> only navigates when it differs from the
   *  current one, so consecutive steps on the same screen don't trigger
   *  a router.push. */
  route: string;
  /** CSS selector to highlight. `null` renders a centered, un-highlighted
   *  popover (used for the welcome and completion steps). */
  selector: string | null;
  /** Keys resolved against the `onboarding.tour` next-intl namespace. */
  titleKey: string;
  descriptionKey: string;
}

/**
 * Master step list for the onboarding tour — one flat sequence spanning
 * every screen. Order matters: it's both the tour's navigation order and
 * (via array length/index) the "Passo X de Y" progress driver.js renders.
 *
 * Every screen after the first starts with an empty state for a brand
 * new account (no contacts/broadcasts/automations yet), so most
 * `selector`s here point at elements that may not exist yet — that's
 * expected and handled by the tour engine's `skipMissingElement` +
 * `waitForElement` config, not by anything in this file.
 */
export const TOUR_STEPS: TourStepDef[] = [
  {
    id: "welcome",
    route: "/dashboard",
    selector: null,
    titleKey: "welcomeTitle",
    descriptionKey: "welcomeDescription",
  },
  {
    id: "dashboard-metrics",
    route: "/dashboard",
    selector: '[data-tour="dashboard-metrics"]',
    titleKey: "dashboardMetricsTitle",
    descriptionKey: "dashboardMetricsDescription",
  },
  {
    id: "dashboard-chart",
    route: "/dashboard",
    selector: '[data-tour="dashboard-chart"]',
    titleKey: "dashboardChartTitle",
    descriptionKey: "dashboardChartDescription",
  },
  {
    id: "inbox-list",
    route: "/inbox",
    selector: '[data-tour="inbox-conversation-list"]',
    titleKey: "inboxListTitle",
    descriptionKey: "inboxListDescription",
  },
  {
    id: "inbox-filters",
    route: "/inbox",
    selector: '[data-tour="inbox-filters"]',
    titleKey: "inboxFiltersTitle",
    descriptionKey: "inboxFiltersDescription",
  },
  {
    id: "inbox-conversation",
    route: "/inbox",
    selector: '[data-tour="inbox-thread"]',
    titleKey: "inboxConversationTitle",
    descriptionKey: "inboxConversationDescription",
  },
  {
    id: "inbox-composer",
    route: "/inbox",
    selector: '[data-tour="inbox-composer"]',
    titleKey: "inboxComposerTitle",
    descriptionKey: "inboxComposerDescription",
  },
  {
    id: "inbox-sidebar",
    route: "/inbox",
    selector: '[data-tour="inbox-contact-sidebar"]',
    titleKey: "inboxSidebarTitle",
    descriptionKey: "inboxSidebarDescription",
  },
  {
    id: "pipeline-board",
    route: "/pipelines",
    selector: '[data-tour="pipeline-board"]',
    titleKey: "pipelineBoardTitle",
    descriptionKey: "pipelineBoardDescription",
  },
  {
    id: "pipeline-columns",
    route: "/pipelines",
    selector: '[data-tour="pipeline-stage-column"]',
    titleKey: "pipelineColumnsTitle",
    descriptionKey: "pipelineColumnsDescription",
  },
  {
    id: "pipeline-new-deal",
    route: "/pipelines",
    selector: '[data-tour="pipeline-new-deal"]',
    titleKey: "pipelineNewDealTitle",
    descriptionKey: "pipelineNewDealDescription",
  },
  {
    id: "pipeline-filters",
    route: "/pipelines",
    selector: '[data-tour="pipeline-filters"]',
    titleKey: "pipelineFiltersTitle",
    descriptionKey: "pipelineFiltersDescription",
  },
  {
    id: "contacts-list",
    route: "/contacts",
    selector: '[data-tour="contacts-table"]',
    titleKey: "contactsListTitle",
    descriptionKey: "contactsListDescription",
  },
  {
    id: "contacts-import",
    route: "/contacts",
    selector: '[data-tour="contacts-import"]',
    titleKey: "contactsImportTitle",
    descriptionKey: "contactsImportDescription",
  },
  {
    id: "contacts-search-filters",
    route: "/contacts",
    selector: '[data-tour="contacts-search-filters"]',
    titleKey: "contactsFiltersTitle",
    descriptionKey: "contactsFiltersDescription",
  },
  {
    id: "broadcasts-list",
    route: "/broadcasts",
    selector: '[data-tour="broadcasts-list"]',
    titleKey: "broadcastsListTitle",
    descriptionKey: "broadcastsListDescription",
  },
  {
    id: "broadcasts-new",
    route: "/broadcasts",
    selector: '[data-tour="broadcasts-new"]',
    titleKey: "broadcastsNewTitle",
    descriptionKey: "broadcastsNewDescription",
  },
  {
    id: "broadcasts-status",
    route: "/broadcasts",
    selector: '[data-tour="broadcasts-status"]',
    titleKey: "broadcastsStatusTitle",
    descriptionKey: "broadcastsStatusDescription",
  },
  {
    id: "automations-list",
    route: "/automations",
    selector: '[data-tour="automations-list"]',
    titleKey: "automationsListTitle",
    descriptionKey: "automationsListDescription",
  },
  {
    id: "automations-ai",
    route: "/automations",
    selector: '[data-tour="automations-ai-create"]',
    titleKey: "automationsAiTitle",
    descriptionKey: "automationsAiDescription",
  },
  {
    id: "reports-tabs",
    route: "/reports",
    selector: '[data-tour="reports-tabs"]',
    titleKey: "reportsTabsTitle",
    descriptionKey: "reportsTabsDescription",
  },
  {
    id: "settings-whatsapp",
    route: "/settings?tab=whatsapp",
    selector: '[data-tour="settings-whatsapp"]',
    titleKey: "settingsWhatsappTitle",
    descriptionKey: "settingsWhatsappDescription",
  },
  {
    id: "settings-quick-replies",
    route: "/settings?tab=quickReplies",
    selector: '[data-tour="settings-quick-replies"]',
    titleKey: "settingsQuickRepliesTitle",
    descriptionKey: "settingsQuickRepliesDescription",
  },
  {
    id: "settings-members",
    route: "/settings?tab=members",
    selector: '[data-tour="settings-members"]',
    titleKey: "settingsMembersTitle",
    descriptionKey: "settingsMembersDescription",
  },
  {
    id: "completion",
    route: "/settings?tab=members",
    selector: null,
    titleKey: "completionTitle",
    descriptionKey: "completionDescription",
  },
];
