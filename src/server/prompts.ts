import { z } from "zod";
import type { GlossaryEntry, RetroFacts, RetroItem, Ticket, TicketSummary } from "@/lib/types";
import { DOR_CRITERIA, DOR_IDS, DOR_STATUSES } from "@/lib/dor";
import type { Calibration } from "./calibration";

export const PROMPT_VERSION = { summary: 1, review: 1, demo: 1, spec: 1, tests: 1, estimate: 8, retro: 2 };

const bi = z.object({ en: z.string(), vi: z.string() });

const summaryBody = z.object({
  summary: z.string(),
  ac: z.array(z.string()),
  areas: z.array(z.string()),
  rules: z.array(z.string()),
  edgeCases: z.array(z.string()),
});
export const summarySchema = z.object({ en: summaryBody, vi: summaryBody });

const codeRef = z.object({ repo: z.string(), path: z.string(), line: z.number().int().nullable() });
export const reviewSchema = z.object({
  currentBehavior: z.array(z.object({ en: z.string(), vi: z.string(), refs: z.array(codeRef) })),
  findings: z.array(
    z.object({
      kind: z.enum(["missing_ac", "ambiguous", "untestable", "contradiction", "code_conflict", "missing_design", "other"]),
      severity: z.enum(["high", "medium", "low"]),
      quote: z.string(),
      en: z.string(),
      vi: z.string(),
      suggestion: bi,
      refs: z.array(codeRef),
    }),
  ),
  questions: z.array(bi),
  impact: z.array(z.object({ repo: z.string(), area: z.string() })),
});

export const specSchema = z.object({ markdown: z.string(), inScope: z.array(z.string()) });

export function specPrompt(
  t: Ticket,
  summary: TicketSummary | null,
  review: { findings: { severity: string; en: string; suggestion: { en: string } }[]; questions: { en: string }[] } | null,
  repos: { key: string; dir: string; path: string; branch: string }[],
  architecture: string,
  glossary: GlossaryEntry[],
): string {
  const repoList = repos.map((r) => `- ${r.dir} (key: ${r.key}): ${r.path} — branch ${r.branch}`).join("\n");
  return [
    "Write an implementation-ready FEATURE SPEC for a coding agent (Claude Code / Copilot) that works in this multi-repo workspace.",
    "Research the CURRENT code first (read-only: Read/Grep/Glob). Never modify anything. Do not write the implementation.",
    "",
    "Rules:",
    "- Ground every claim about the code in what you read; cite paths as `<repo dir>/<path>:<line>` (e.g. `frontend-repo/src/hooks/x.ts:42`).",
    "- Decide which projects are actually in scope (frontend / backend / bff / protobuf). A shared-contract change pulls in protobuf + its backend/bff consumers — say so.",
    "- Keep the ticket's real values (labels, messages, limits) verbatim. Do not invent requirements; unclear points go to Open questions.",
    "- English only. Markdown only, no preamble.",
    "",
    "Use exactly this structure:",
    `# ${t.key} — <title>`,
    `**Jira:** ${t.url}`,
    `**Type:** ${t.type} · **Status:** ${t.status}`,
    "## Summary — 2–4 sentences: who, what, why.",
    "## Scope — In scope / Out of scope bullets, then **Projects in scope:** with one line of reason each.",
    "## Business rules (from Jira)",
    "## Acceptance criteria — numbered, testable, verbatim values.",
    "## Current state (from codebase research) — one ### subsection per relevant repo: what exists today, with file:line refs.",
    "## Implementation outline — one ### subsection per in-scope project: ordered steps naming the files/functions to add or change, and the tests to add or update.",
    "## Decisions — choices already implied by the ticket or code (e.g. reuse X instead of adding Y).",
    "## Open questions — anything the PO/BA must answer before or during implementation.",
    "",
    "Also return `inScope`: the in-scope repo keys.",
    "",
    "## Repos (read-only)",
    repoList,
    "",
    architecture ? `## Architecture notes\n${architecture}\n` : "",
    glossaryBlock(glossary),
    summary ? `## Existing summary\n${summary.en.summary}\nAC:\n${summary.en.ac.map((a) => `- ${a}`).join("\n")}\n` : "",
    review && review.findings.length
      ? `## Earlier spec review (carry unresolved items into Open questions)\n${review.findings.map((f) => `- [${f.severity}] ${f.en} → ${f.suggestion.en}`).join("\n")}\n${review.questions.map((q) => `- Q: ${q.en}`).join("\n")}\n`
      : "",
    ticketBlock(t),
  ].join("\n");
}

type ReviewContext = {
  currentBehavior: { en: string }[];
  findings: { severity: string; en: string; suggestion: { en: string } }[];
  questions: { en: string }[];
} | null;

function reviewBlock(review: ReviewContext, title: string): string {
  if (!review) return "";
  return [
    `## ${title}`,
    ...review.currentBehavior.map((c) => `- Current code: ${c.en}`),
    ...review.findings.map((f) => `- Finding [${f.severity}]: ${f.en} → ${f.suggestion.en}`),
    ...review.questions.map((q) => `- Open question: ${q.en}`),
    "",
  ].join("\n");
}

export const testsSchema = z.object({
  acList: z.array(bi),
  scenarios: z.array(
    z.object({
      id: z.string(),
      title: bi,
      type: z.enum(["happy", "edge", "negative", "permission", "regression"]),
      priority: z.enum(["high", "medium", "low"]),
      ac: z.array(z.number().int()),
      given: z.array(bi),
      when: z.array(bi),
      then: z.array(bi),
      data: z.string(),
    }),
  ),
  gaps: z.array(bi),
});

export function testsPrompt(t: Ticket, summary: TicketSummary | null, review: ReviewContext, glossary: GlossaryEntry[]): string {
  return [
    "You are a QA engineer. Write the test scenarios for this Jira ticket from its acceptance criteria. Do not invent requirements.",
    BILINGUAL_RULE,
    "",
    "Output:",
    "- acList: the acceptance criteria as a numbered list (1-based by array position), short and testable, real values kept.",
    "- scenarios: ids TC-01, TC-02…; cover every AC with at least one happy-path scenario, then add edge (limits, empty, max length, " +
      "boundaries), negative (invalid input, error states) and permission scenarios only where the ticket or the code facts below make them " +
      "relevant; regression = existing behaviour that must keep working. `ac` lists the AC numbers the scenario covers ([] for regression). " +
      "Steps are Given/When/Then arrays of short sentences (no keyword prefix). Priority: high = core AC, medium = edge/negative, low = nice to have.",
    "- data: concrete test data the scenario needs (values from the ticket, example B/L numbers it names); empty string if none.",
    "- gaps: AC that cannot be tested as written, or information QA still needs (e.g. missing error message text).",
    "Prefer 6–15 sharp scenarios over many near-duplicates. Use the code facts below for real boundary values.",
    "",
    glossaryBlock(glossary),
    summary ? `## Existing summary\n${summary.en.summary}\nAC:\n${summary.en.ac.map((a) => `- ${a}`).join("\n")}\n` : "",
    reviewBlock(review, "Code facts and spec review (from an earlier code-aware review)"),
    ticketBlock(t),
  ].join("\n");
}

export const ESTIMATE_SCALE = [0.5, 1, 2, 3, 5, 8, 13, 21];

// References come first so the model commits to its comparison before it picks a number.
export const estimateSchema = z.object({
  references: z.array(z.object({ key: z.string(), points: z.number(), why: bi })),
  // Definition of Ready — checked before the number so readiness gaps land in confidence/range, not in a vague bump.
  dor: z.array(z.object({ id: z.enum(DOR_IDS), status: z.enum(DOR_STATUSES), note: bi })),
  points: z.number(),
  low: z.number(),
  high: z.number(),
  confidence: z.enum(["high", "medium", "low"]),
  brief: bi,
  summary: bi,
  inScope: z.array(z.string()),
  tasks: z.array(z.object({ repo: z.string(), title: bi, detail: bi, size: z.enum(["XS", "S", "M", "L", "XL"]) })),
  reasons: z.array(z.object({ en: z.string(), vi: z.string(), effect: z.enum(["up", "down", "neutral"]) })),
  risks: z.array(bi),
  assumptions: z.array(bi),
  questions: z.array(bi),
  split: z.array(bi),
});

function calibrationBlock(cal: Calibration): string {
  if (!cal.total) return "## Team's done stories\n_(none available — estimate conservatively and set confidence low)_\n";
  const dist = cal.distribution.map((d) => `${d.points} pts: ${Math.round(d.share * 100)}%`).join(" · ");
  const unused = ESTIMATE_SCALE.filter((p) => p > 0.5 && !cal.distribution.some((d) => d.points === p));
  return [
    `## Team's scale — ${cal.total} recently done stories`,
    `${dist}. Median ${cal.median} pts.${unused.length ? ` Never used: ${unused.join(", ")}.` : ""}`,
    "This is the team's real base rate. Most stories land at or near the median; values used by < 5% of stories need exceptional, concrete evidence.",
    "",
    "## Most similar done stories (choose `references` ONLY from these)",
    ...cal.similar.map((c) => `- ${c.key} [${c.points} pts] ${c.summary}${c.excerpt ? ` — ${c.excerpt}` : ""}`),
    "",
    "## Other done stories (scale only)",
    ...cal.others.map((c) => `- ${c.key} [${c.points}] ${c.summary}`),
    "",
  ].join("\n");
}

export function estimatePrompt(
  t: Ticket,
  summary: TicketSummary | null,
  review: ReviewContext,
  repos: { key: string; dir: string; path: string; branch: string }[],
  architecture: string,
  designSystem: string,
  cal: Calibration,
  glossary: GlossaryEntry[],
): string {
  const codeAware = repos.length > 0;
  return [
    "You are a senior engineer on this team estimating a Jira story in STORY POINTS for planning poker.",
    "Story points are RELATIVE: this story compared with stories the team already finished — not hours, not a list of every task.",
    codeAware
      ? "You may read the CURRENT code (read-only: Read/Grep/Glob, never modify anything) to judge how big the change really is."
      : "You have no code access; estimate from the ticket and the notes below.",
    "",
    "Procedure (follow it in order):",
    "1. Pick the 1–3 done stories from 'Most similar' whose AMOUNT OF CHANGE is closest (how much must be built or changed), not just the same " +
      "screen or topic. A same-topic story with clearly more scope is a weak reference; prefer a smaller story with a similar-size change. " +
      "Put them in `references` with why they compare in size.",
    "2. Anchor on their points (the median if they differ; the lower middle value when there is an even count).",
    "   Size cues: a static option list, label/format change or display-only field is usually the team's smallest stories; " +
      "a new editable flow with validation and save is mid-size; new persistence/contracts across services is the upper end.",
    "3. Definition of Ready check: assess EVERY criterion in '## Definition of Ready criteria' below and put one item per id in `dor`. " +
      "Status pass (sufficient evidence in the ticket), partial (some information but incomplete or unclear), fail (missing or contradicted), " +
      "not_verifiable (the evidence would be in a design/attachment/link you cannot open), na (genuinely does not apply, e.g. UI-* when the story " +
      "has no UI impact — never use na just because information is missing). Be evidence-based: a criterion merely mentioned without detail is not pass; " +
      "do not invent requirements, designs or decisions. INVEST is a quality judgement, not a keyword check.",
    "   Effect on points: readiness gaps NEVER add points. A gap that makes the size uncertain (US-05, US-06, US-08, US-09, US-10, UI-03, UI-05, " +
      "UI-06, AC-01, AC-03, AC-04, SOL-03, SOL-06 partial/fail/not_verifiable) lowers `confidence`, may raise `high` one step, and becomes a " +
      "`questions` item. Format-only gaps (AC-02 Gherkin, UI-02 governance evidence, UI-04 link) do not change confidence — just report them. " +
      "US-06 fail → propose a `split`.",
    "   UI-06 MDS alignment in detail: if the story has UI work, decide whether the proposed UI uses only standard MDS " +
      "(Design System) components or needs a customized / deviating one. Which packages are MDS and what counts as a customization " +
      "is defined in the 'Design system (MDS)' notes — follow them, do not guess." +
      (codeAware
        ? " Verify in the frontend: find the screen/component the story changes, check its imports (MDS package vs local component), " +
          "and look for styled(...) / module.css overrides or an existing wrapper in components/common that the change would reuse or modify."
        : " Without code access, judge only from what the ticket states (component names, 'use the existing …', 'custom …')."),
    "   UI-06 is pass when only standard MDS components are needed or every customization is agreed and documented; partial/fail when a " +
      "customization has no documented reason, risk review or UI/UX + tech agreement; not_verifiable when the design does not show which " +
      "components are used; na when there is no UI impact. Its note names each customized component, why it is needed, the main risk " +
      "(UI consistency, accessibility, responsiveness, maintainability, future MDS compatibility) and whether it is agreed.",
    "   Effect on points: a customized component the reference stories did not have (building or overriding it, extra accessibility/responsive " +
      "work, keeping it MDS-compatible) is a concrete difference for step 4 — name it in `reasons`. Standard MDS only → no extra points " +
      "(reusing existing components can pull DOWN). UI-06 not pass → do NOT add points for a guess: " +
      "lower `confidence`, raise `high` one step, and add a question (which component, why, agreed with UI/UX and TA?) — DoR says the story is not Ready until resolved.",
    "4. Adjust from the anchor by AT MOST one step on the scale, and only for a concrete difference you can name " +
      "(e.g. 'also needs a new gRPC field end-to-end', 'needs a customized MDS table with sticky columns', or 'the component already exists'). " +
      "No concrete difference → keep the anchor.",
    "5. When torn between two values, choose the LOWER one. Do not round up for safety — uncertainty goes into `confidence`, `low`/`high`, risks and questions.",
    "6. Never add points for routine work every reference story also had: unit tests, QA/verification, code review, PR, deployment, " +
      "reading/understanding code, small UI wiring. The references' points already include all of that.",
    codeAware
      ? "7. Code findings matter only as a DIFFERENCE from the references: many touched files is not big if each change is mechanical; " +
        "existing logic you can reuse pulls the estimate DOWN. Do not let a long task list inflate the number."
      : "",
    "",
    "Output rules:",
    `- Scale: ${ESTIMATE_SCALE.join(", ")}. \`points\`, \`low\`, \`high\` must be on it; low ≤ points ≤ high, usually one step either side.`,
    "- reasons: name the anchor first ('Like INTERNAL-123 (3 pts) …'), then each adjustment; effect up/down/neutral. 2–5 items.",
    "- tasks: the work breakdown per project (repo key = frontend / backend / bff / protobuf / qa), ordered; size XS–XL is relative to this story. " +
      "Name concrete files/modules when you found them. This list explains the work — it is not summed into points.",
    "- brief: the answer to 'why N points?' in planning — exactly 1 or 2 sentences (never 3), ≤ 25 words, naming the anchor story and the main difference.",
    "- summary: the fuller analysis paragraph (what exists, what changes, where the effort goes).",
    "- confidence: low when the AC is unclear, references are weak matches, or the code impact is uncertain.",
    "- split: only if points ≥ 8, how to split the story (one item per part); otherwise [].",
    "- dor[].note: one short sentence — the evidence for pass/na, otherwise the gap and the action needed to close it.",
    "- risks, assumptions, questions: short, concrete, only what matters for the estimate.",
    "- inScope: project keys this story touches.",
    BILINGUAL_RULE,
    "",
    "## Definition of Ready criteria",
    ...DOR_CRITERIA.map((c) => `- ${c.id} ${c.name}: ${c.check}`),
    "",
    calibrationBlock(cal),
    codeAware ? `## Repos (read-only)\n${repos.map((r) => `- ${r.dir} (key: ${r.key}): ${r.path} — branch ${r.branch}`).join("\n")}\n` : "",
    codeAware && architecture ? `## Architecture notes\n${architecture}\n` : "",
    designSystem ? `${designSystem}\n` : "",
    glossaryBlock(glossary),
    summary ? `## Existing summary\n${summary.en.summary}\n` : "",
    reviewBlock(review, "Earlier code-aware review"),
    // Hide the current Jira estimate so it doesn't anchor the AI.
    ticketBlock({ ...t, points: null }),
    // Attachment names are evidence for wireframe/design criteria (UI-01, UI-03, UI-04); their content is not readable here.
    t.attachments.length ? `\n### Attachments (names only — content not accessible)\n${t.attachments.map((a) => `- ${a.filename}`).join("\n")}` : "",
  ].join("\n");
}

export const demoStorySchema = z.object({
  title: z.string(),
  tag: z.string(),
  headlineLead: z.string(),
  headlineRest: z.string(),
  purpose: z.string(),
  why: z.string(),
  improving: z.string(),
  scenarios: z.array(z.object({ name: z.string(), steps: z.array(z.string()) })),
  testIds: z.array(z.string()),
});

export function glossaryBlock(glossary: GlossaryEntry[]): string {
  if (!glossary.length) return "";
  const lines = glossary.map((g) =>
    g.keep ? `- "${g.term}": keep exactly as "${g.term}" in both languages` : `- "${g.term}": EN "${g.en}", VI "${g.vi}"`,
  );
  return `## Glossary (use these translations consistently)\n${lines.join("\n")}\n`;
}

export function ticketBlock(t: Ticket): string {
  return [
    `## Ticket ${t.key} — ${t.summary}`,
    `Type: ${t.type} · Status: ${t.status}${t.points != null ? ` · Story points: ${t.points}` : ""}`,
    t.parentKey ? `Parent: ${t.parentKey} ${t.parentSummary ?? ""}` : "",
    t.labels.length ? `Labels: ${t.labels.join(", ")}` : "",
    t.links.length ? `Linked: ${t.links.map((l) => `${l.type} ${l.key} (${l.summary})`).join("; ")}` : "",
    "",
    "### Description",
    t.descriptionMd || "_(empty)_",
    "",
    "### Acceptance criteria",
    t.acMd || "_(no separate AC field — look for AC inside the description)_",
  ]
    .filter((l) => l !== "")
    .join("\n");
}

const BILINGUAL_RULE =
  "Write every text field twice: `en` in clear English, `vi` in natural Vietnamese for a Vietnamese developer " +
  "(keep code identifiers, field names, UI labels and glossary terms untranslated).";

export function summaryPrompt(t: Ticket, glossary: GlossaryEntry[]): string {
  return [
    "You help a software developer understand a Jira ticket quickly. Summarize it faithfully — do not invent requirements.",
    BILINGUAL_RULE,
    "- summary: one short paragraph: who wants what and why.",
    "- ac: the acceptance criteria as a checklist of short testable statements (rewrite, keep meaning, keep real values).",
    "- areas: screens / UI areas / modules affected.",
    "- rules: business rules and validations stated or implied.",
    "- edgeCases: edge cases worth checking (empty, limits, permissions, error states). Only ones grounded in the ticket.",
    "",
    glossaryBlock(glossary),
    ticketBlock(t),
  ].join("\n");
}

export function reviewPrompt(
  t: Ticket,
  summary: TicketSummary | null,
  repos: { key: string; label: string; path: string; branch: string }[],
  architecture: string,
  glossary: GlossaryEntry[],
): string {
  const repoList = repos.map((r) => `- ${r.key} (${r.label}): ${r.path} — branch ${r.branch}`).join("\n");
  return [
    "You are a senior engineer reviewing a Jira ticket BEFORE implementation, against the CURRENT source code.",
    "You may only read files (Read/Grep/Glob). Never modify anything.",
    "",
    "Steps:",
    "1. Use the architecture notes to locate the modules this ticket touches, then grep/read the relevant code in the repos below.",
    "2. currentBehavior: what the code does today for this area (2–6 items), each with file refs.",
    "3. findings: problems in the SPEC — missing_ac, ambiguous wording, untestable AC, contradiction (description vs AC), " +
      "code_conflict (AC disagrees with existing validation/enum/field/flow), missing_design (UI change without a design link), other. " +
      "Quote the exact ticket sentence in `quote`. Severity: high = blocks implementation, medium = likely rework, low = nice to clarify.",
    "4. questions: precise questions for the PO/BA that would resolve the findings; cite existing behavior when relevant " +
      "(e.g. 'Today X is limited to 35 chars in Y — should the new field follow that?').",
    "5. impact: which repo/module is likely touched (informational).",
    "Refs: `repo` is the repo key below, `path` is relative to that repo root, `line` is a 1-based line or null.",
    "Only report what you verified in code or read in the ticket. Prefer fewer, sharper findings.",
    BILINGUAL_RULE,
    "",
    "## Repos (read-only)",
    repoList,
    "",
    architecture ? `## Architecture notes\n${architecture}\n` : "",
    glossaryBlock(glossary),
    summary ? `## Existing summary (EN)\n${summary.en.summary}\n` : "",
    ticketBlock(t),
  ].join("\n");
}

export function demoPrompt(t: Ticket, summary: TicketSummary | null, skill: { skillMd: string; scriptFormat: string; example: string }, glossary: GlossaryEntry[]): string {
  return [
    "Follow the sprint-demo-prep skill below to write the Sprint Review content for ONE story.",
    "Do only section 3 (slide content) and the scenarios for section 5 (demo script); the app builds the deck and renders the script itself.",
    "Do not fetch Jira — the ticket is given below. English only (business audience).",
    "",
    "Output fields:",
    "- title: action phrase rewritten from the Jira summary, ≤ ~70 chars, no 'As a … I want'.",
    "- tag: IMPROVEMENT, NEW FEATURE or BUG FIX.",
    "- headlineLead + headlineRest: the two-part hook (lead is short, e.g. 'One number, ').",
    "- purpose: one sentence 'Let a/an <role> <do X>, <instead of / so that …>.'",
    "- why: 2–3 sentences, under ~45 words.",
    "- improving: one sentence on the concrete behaviour change.",
    "- scenarios: 2–6 items; `name` ≤ ~60 chars, sentence case (these are the WHAT WE'LL DEMO items); " +
      "`steps` are 2–4 bullets WITHOUT the leading '* ', written as 'I …' / 'I can see …' from the AC.",
    "- testIds: real test record IDs the ticket explicitly names (e.g. TEST B/L numbers in AC example tables). Never invent; empty if none.",
    "",
    "=== SKILL.md ===",
    skill.skillMd,
    "=== references/demo-script-format.md ===",
    skill.scriptFormat,
    "=== assets/content.example.json ===",
    skill.example,
    "",
    glossaryBlock(glossary),
    summary ? `## Ticket summary\n${summary.en.summary}\nAC:\n${summary.en.ac.map((a) => `- ${a}`).join("\n")}\n` : "",
    ticketBlock(t),
  ].join("\n");
}

export const retroSchema = z.object({
  headline: bi,
  cards: z.array(
    z.object({
      column: z.enum(["well", "improve", "action"]),
      title: bi,
      detail: bi,
      evidence: z.array(z.string()),
      metric: bi,
    }),
  ),
});

function retroList(label: string, items: RetroItem[], max = 15): string {
  if (!items.length) return `${label}: none`;
  const rows = items.slice(0, max).map((i) => `  - ${i.key} [${i.type}, ${i.status}${i.points != null ? `, ${i.points} pts` : ""}${i.note ? `, ${i.note}` : ""}] ${i.summary}`);
  return [`${label} (${items.length}):`, ...rows, ...(items.length > max ? [`  - … ${items.length - max} more`] : [])].join("\n");
}

export function retroPrompt(f: RetroFacts, notes: string, glossary: GlossaryEntry[]): string {
  const u = f.unit === "points" ? "pts" : "items";
  const amount = (x: { items: number; points: number }) => (f.unit === "points" ? `${x.points} pts (${x.items} items)` : `${x.items} items`);
  return [
    "You prepare insight cards for a Scrum team's Sprint Retrospective. Developers copy the cards onto the team's retro board.",
    BILINGUAL_RULE,
    "",
    "Columns:",
    "- well: what went well and is worth keeping (2–5 cards).",
    "- improve: what did not go well / slowed the team down (2–5 cards).",
    "- action: concrete, small actions for the NEXT sprint that address the improve cards (2–4 cards). Start with a verb; make each checkable at the next retro.",
    "",
    "Rules:",
    "- Every card must be grounded in the facts below. No generic agile advice that would fit any sprint.",
    "- evidence: the ticket keys that back the card (from the facts; [] if it is about totals). metric: one short number phrase in both languages, e.g. \"3 items added after start\" / \"3 item thêm sau khi bắt đầu\" (empty strings if none).",
    "- title: max ~8 words, written like a sticky note. detail: 1–2 sentences explaining the why / impact.",
    "- Talk about the process and the work, never blame or name individuals.",
    "- Positive cards are real: e.g. finishing the commitment, little scope change, fast cycle time, few reopens, good spec reviews before dev.",
    "- Don't double-count: one fact → one card. If the sprint is still running, say \"so far\" and keep the cards cautious.",
    "- If the team notes below mention something, include it (it outweighs the numbers when they disagree).",
    "- headline: one sentence summing up the sprint.",
    "",
    glossaryBlock(glossary),
    `## Sprint: ${f.sprint.name} (${f.sprint.startDate?.slice(0, 10) ?? "?"} → ${f.sprint.endDate?.slice(0, 10) ?? "?"}, ${f.ended ? "ended" : "still running"})`,
    f.sprint.goal ? `Goal: ${f.sprint.goal}` : "Goal: (none set)",
    `Scope: ${amount(f.total)} in the sprint; committed at start ${amount(f.committed)}; completed within the sprint ${amount(f.completed)}.`,
    `Velocity of the previous sprints (done ${u}): ${f.velocity.length ? f.velocity.map((v) => `${v.name}: ${v.done}`).join(", ") : "unknown"}.`,
    `Cycle time (in progress → done), median: ${f.cycle.medianDays ?? "unknown"} days.`,
    `Bugs in the sprint: ${f.bugs.total}.`,
    "",
    retroList("Added after the sprint started", f.added),
    retroList(f.ended ? "Not done by the end (carried out)" : "Not done yet", f.notDone),
    retroList("Carried in from an earlier sprint", f.carriedIn),
    retroList("Reopened after being done", f.reopened),
    retroList("Re-estimated during the sprint", f.reestimated),
    retroList("Requirements (summary / description / AC) edited after the sprint started", f.reqChanged),
    retroList("Flagged / blocked at some point", f.flagged),
    retroList("Bugs created during the sprint", f.bugs.createdInSprint),
    retroList("Slowest items (cycle time)", f.cycle.slowest),
    retroList("No story points", f.unpointed),
    retroList("Spec review found high-severity gaps before dev", f.specRisks),
    "",
    "## Team notes",
    notes.trim() || "(none)",
  ].join("\n");
}
