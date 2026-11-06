export type Lang = "en" | "vi";
export type Bilingual = { en: string; vi: string };
export type AiProvider = "claude" | "copilot";

export interface GlossaryEntry {
  term: string;
  en: string;
  vi: string;
  keep: boolean;
}

export interface RepoConfig {
  key: string;
  label: string;
  dir: string;
  path: string;
  enabled: boolean;
}

export interface Settings {
  jira: {
    baseUrl: string;
    email: string;
    boardId: string;
    projectKey: string;
    spField: string;
    acField: string;
    flaggedField: string;
    /** Kéo Task: exact Jira names of the AI tracking fields and the action value it writes (all optional). */
    aiActionField: string;
    aiScoreField: string;
    aiActionValue: string;
  };
  ai: {
    provider: AiProvider;
    claudeBin: string;
    copilotBin: string;
    claudeModel: string;
    copilotModel: string;
    concurrency: number;
  };
  repos: RepoConfig[];
  workspaceRoot: string;
  demo: { testLinkTemplate: string; activeTemplateId: string };
  recording: RecordingSettings;
  glossary: GlossaryEntry[];
  features: { figma: boolean; usage: boolean; recording: boolean; jiraWrite: boolean; logTime: boolean };
  timeTracker: TimeTrackerSettings;
}

export type TtsProvider = "openai" | "elevenlabs" | "macos";

export interface RecordingSettings {
  /** Base URL of the web app the demo is recorded on (a test environment). */
  appUrl: string;
  browser: "chrome" | "chromium";
  width: number;
  height: number;
  tts: {
    provider: TtsProvider;
    openaiModel: string;
    openaiVoice: string;
    elevenModel: string;
    elevenVoiceId: string;
    instructions: string;
    /** macOS `say` voice name; "" = system default. */
    macVoice: string;
  };
}

export interface PublicSettings extends Settings {
  secrets: Record<"jira.token" | "figma.token" | "openai.key" | "elevenlabs.key" | "timetracker.password", { set: boolean; last4: string }>;
  dataHome: string;
}

export type StatusCategory = "new" | "indeterminate" | "done";

export interface Ticket {
  key: string;
  id: string;
  url: string;
  type: string;
  subtask: boolean;
  summary: string;
  status: string;
  statusCategory: StatusCategory;
  assignee: { accountId: string; name: string; avatar: string } | null;
  points: number | null;
  parentKey: string | null;
  parentSummary: string | null;
  parentType: string | null;
  descriptionMd: string;
  acMd: string;
  links: { type: string; key: string; summary: string; status: string }[];
  attachments: { filename: string; mimeType: string; size: number; url: string }[];
  labels: string[];
  flagged: boolean;
  updated: string;
  created: string;
  figmaLinks: string[];
}

export interface SprintTicket extends Ticket {
  unseenChange: boolean;
  hasSummary: boolean;
  review: { high: number; medium: number; low: number } | null;
  reviewStale: Staleness | null;
}

export interface Sprint {
  id: number;
  name: string;
  state: "active" | "future" | "closed";
  startDate: string | null;
  endDate: string | null;
  goal: string;
}

export interface SummaryBody {
  summary: string;
  ac: string[];
  areas: string[];
  rules: string[];
  edgeCases: string[];
}
export interface TicketSummary {
  en: SummaryBody;
  vi: SummaryBody;
}

export interface CodeRef {
  repo: string;
  path: string;
  line: number | null;
}

export type FindingKind =
  | "missing_ac"
  | "ambiguous"
  | "untestable"
  | "contradiction"
  | "code_conflict"
  | "missing_design"
  | "other";
export type Severity = "high" | "medium" | "low";

export interface TicketReview {
  currentBehavior: { en: string; vi: string; refs: CodeRef[] }[];
  findings: {
    kind: FindingKind;
    severity: Severity;
    quote: string;
    en: string;
    vi: string;
    suggestion: Bilingual;
    refs: CodeRef[];
  }[];
  questions: Bilingual[];
  impact: { repo: string; area: string }[];
}

export interface StoredReview extends TicketReview {
  reviewedAt: string;
  /** Hash of summary + description + AC when generated; missing on records made before it existed. */
  ticketHash?: string;
  repos: Record<string, { branch: string; head: string; dirty: boolean; path: string }>;
}

/** "stale" = the ticket content changed; "maybe" = only the update time is newer (old record, or e.g. a status change). */
export interface Staleness {
  state: "stale" | "maybe";
  reason: "content" | "updated" | "review";
}

export interface StoredSpec {
  markdown: string;
  inScope: string[];
  generatedAt: string;
  ticketHash?: string;
  reviewedAt?: string | null;
  repos: Record<string, { branch: string; head: string; dirty: boolean }>;
}

export type TestType = "happy" | "edge" | "negative" | "permission" | "regression";

export interface TestScenario {
  id: string;
  title: Bilingual;
  type: TestType;
  priority: Severity;
  ac: number[];
  given: Bilingual[];
  when: Bilingual[];
  then: Bilingual[];
  data: string;
}

export interface StoredTests {
  acList: Bilingual[];
  scenarios: TestScenario[];
  gaps: Bilingual[];
  generatedAt: string;
  ticketHash: string;
  usedReview: boolean;
}

export type TaskSize = "XS" | "S" | "M" | "L" | "XL";

export interface StoredEstimate {
  key: string;
  title: string;
  type: string;
  jiraPoints: number | null;
  /** Final estimate (AI value kept within one step of `anchor`). */
  points: number;
  /** What the AI proposed before the anchor guard; older records lack it. */
  aiPoints?: number;
  /** Median Jira points of the reference stories. */
  anchor?: number | null;
  teamMedian?: number | null;
  low: number;
  high: number;
  confidence: Severity;
  /** Two-line justification for planning; missing on estimates made before it existed. */
  brief?: Bilingual;
  summary: Bilingual;
  inScope: string[];
  tasks: { repo: string; title: Bilingual; detail: Bilingual; size: TaskSize }[];
  reasons: (Bilingual & { effect: "up" | "down" | "neutral" })[];
  risks: Bilingual[];
  assumptions: Bilingual[];
  questions: Bilingual[];
  split: Bilingual[];
  references: { key: string; points: number; why: Bilingual; summary: string }[];
  calibrationCount: number;
  codeAware: boolean;
  repos: Record<string, { branch: string; head: string; dirty: boolean }>;
  estimatedAt: string;
  ticketHash: string;
}

export interface Snapshot {
  updated: string;
  summary: string;
  descriptionMd: string;
  acMd: string;
  viewedAt: string;
}

export interface JobState<T = unknown> {
  id: string;
  kind: string;
  status: "running" | "done" | "error";
  progress: { done: number; total: number; label: string };
  items: Record<string, { status: "pending" | "running" | "done" | "error" | "cached"; error?: string }>;
  result?: T;
  error?: string;
  startedAt: number;
  finishedAt?: number;
}

export interface RepoStatus {
  ok: boolean;
  error?: string;
  branch: string;
  detached: boolean;
  head: string;
  dirty: boolean;
  ahead: number | null;
  behind: number | null;
  upstream: string;
}

export interface DemoScenario {
  name: string;
  steps: string[];
}

export interface DemoStory {
  key: string;
  title: string;
  tag: string;
  status: string;
  headline: [string, string];
  purpose: string;
  why: string;
  improving: string;
  scenarios: DemoScenario[];
  testIds: string;
}

export interface DemoDraft {
  sprintId: number | null;
  sprintName: string;
  glanceTitle: string;
  stories: DemoStory[];
  updatedAt: string;
}

export interface TemplateInspect {
  ok: boolean;
  error?: string;
  slides: { n: number; kind: string; screenshots: number; items: number | null; title: string }[];
  purposeTemplate: number | null;
  demoTemplate: number | null;
}

export interface TemplateMeta {
  id: string;
  name: string;
  size: number;
  uploadedAt: string;
  inspect: TemplateInspect;
}

export interface BuildMeta {
  id: string;
  createdAt: string;
  sprintName: string;
  templateName: string;
  storyKeys: string[];
  check: { ok: boolean; issues: string[] };
  hasPdf: boolean;
}

export interface UsageEntry {
  ts: string;
  task: string;
  provider: AiProvider | "cache";
  ms: number;
  ok: boolean;
  costUsd?: number;
  error?: string;
}

// ---------------------------------------------------------------- demo recording

export type FlowActionType = "goto" | "click" | "fill" | "select" | "press" | "hover" | "waitFor" | "scroll" | "wait" | "resize" | "dblclick";
export type FlowTargetBy = "role" | "text" | "label" | "placeholder" | "testId" | "css";

export interface FlowTarget {
  by: FlowTargetBy;
  value: string;
  /** Accessible name for `role` targets; "" otherwise. */
  name: string;
  /** Which match to use when several elements match (0-based). */
  nth: number;
}

export interface FlowAction {
  type: FlowActionType;
  target: FlowTarget | null;
  /** goto: path or URL · fill/select: text · press: key · wait: milliseconds · resize: "1536x900". */
  value: string;
}

export interface FlowStep {
  narration: string;
  actions: FlowAction[];
  screenshot: boolean;
}

export interface DemoFlow {
  scenarios: { name: string; steps: FlowStep[] }[];
  notes: string[];
}

export interface FlowFile {
  key: string;
  flow: DemoFlow;
  generatedAt: string;
  editedAt?: string;
  /** Must be ticked by a person before the flow may run against the test environment. */
  approved: boolean;
}

export interface RecordingShot {
  file: string;
  scenario: number;
  step: number;
  caption: string;
}

export interface RecordingManifest {
  key: string;
  recordedAt: string;
  ok: boolean;
  video: string | null;
  voice: boolean;
  durationMs: number;
  shots: RecordingShot[];
  /** Screenshot files chosen for the demo slide (max 3). */
  selected: string[];
  errors: { scenario: number; step: number; message: string; shot: string | null }[];
}

// ---------------------------------------------------------------- sprint retro

export type RetroColumn = "well" | "improve" | "action";

export interface RetroItem {
  key: string;
  summary: string;
  type: string;
  status: string;
  points: number | null;
  /** Short extra fact, e.g. "3 → 5" for a re-estimate or "6.5 d" for cycle time. */
  note?: string;
}

/** Numbers computed from Jira (sprint membership + changelog), no AI. */
export interface RetroFacts {
  sprint: Sprint;
  /** Sprint is closed or past its end date; otherwise numbers are "so far". */
  ended: boolean;
  unit: "points" | "items";
  total: { items: number; points: number };
  committed: { items: number; points: number };
  completed: { items: number; points: number };
  added: RetroItem[];
  notDone: RetroItem[];
  carriedIn: RetroItem[];
  reopened: RetroItem[];
  reestimated: RetroItem[];
  reqChanged: RetroItem[];
  flagged: RetroItem[];
  bugs: { total: number; createdInSprint: RetroItem[] };
  cycle: { medianDays: number | null; slowest: RetroItem[] };
  unpointed: RetroItem[];
  velocity: { name: string; done: number }[];
  /** Stories with a high-severity finding in this dashboard's spec review. */
  specRisks: RetroItem[];
}

export interface RetroCard {
  id: string;
  column: RetroColumn;
  title: Bilingual;
  detail: Bilingual;
  evidence: string[];
  metric: Bilingual;
  source: "ai" | "manual";
  /** Changed by a person; kept when the AI cards are regenerated. */
  edited?: boolean;
  /** Already copied to the team's retro board. */
  pushed?: boolean;
}

export interface RetroBoard {
  sprintId: number;
  sprintName: string;
  generatedAt: string | null;
  factsHash: string | null;
  headline: Bilingual | null;
  notes: string;
  cards: RetroCard[];
}

// ---------------------------------------------------------------- log time (TimeTracker NX)

export interface TimeSlot {
  start: string; // "HH:MM"
  end: string;
  task: "main" | "kaizen";
}

/** All values are per user and live only in ~/.dev-dashboard (the password is a secret). */
export interface TimeTrackerSettings {
  baseUrl: string;
  userId: string;
  loginName: string;
  mainTaskId: string;
  kaizenTaskId: string;
  slots: TimeSlot[];
}
