/**
 * Definition of Ready criteria checked during estimation — only the ones that affect how accurate the points are.
 * Left out on purpose: US-01 (story wording), SOL-01 (the estimate is what this produces), SOL-04/SOL-05
 * (Technical Refinement normally happens after estimation).
 */
export const DOR_CRITERIA = [
  { id: "US-02", stage: 1, name: "Independent (INVEST)", check: "Can be developed and delivered with minimal dependency on other stories; unavoidable dependencies are identified and understood." },
  { id: "US-03", stage: 1, name: "Negotiable (INVEST)", check: "Describes the need and outcome without prescribing every implementation detail." },
  { id: "US-04", stage: 1, name: "Valuable (INVEST)", check: "The user or business value is explicit." },
  { id: "US-05", stage: 1, name: "Estimable (INVEST)", check: "Scope, expected behaviour and constraints are clear enough to estimate." },
  { id: "US-06", stage: 1, name: "Small (INVEST)", check: "Fits in one sprint; no multiple unrelated outcomes (else recommend a split)." },
  { id: "US-07", stage: 1, name: "Testable (INVEST)", check: "Expected behaviour and outcomes can be verified objectively." },
  { id: "US-08", stage: 1, name: "Business dependencies identified", check: "Dependencies on other stories, teams, systems, decisions or external parties are named, with impact and coordination understood." },
  { id: "US-09", stage: 1, name: "Business requirements understood", check: "Business context, expected outcome and scope are clear." },
  { id: "US-10", stage: 1, name: "No blocking business questions", check: "No open business/requirement question blocks starting or finishing the story." },
  { id: "UI-01", stage: 1, name: "Wireframe available", check: "A wireframe or prototype exists for the flow/screen when UI work is in scope." },
  { id: "UI-02", stage: 1, name: "Design Governance compliance", check: "Evidence the UI design passed Chorus Design Governance review." },
  { id: "UI-03", stage: 1, name: "UI design ready", check: "Final UI design is complete and detailed enough to build (a preliminary wireframe alone is not enough)." },
  { id: "UI-04", stage: 1, name: "UI included in the story", check: "The design is attached to or linked from the story." },
  { id: "UI-05", stage: 1, name: "Design requirements clear", check: "States, interactions, validation, messages and responsive behaviour are clear enough to implement." },
  { id: "UI-06", stage: 1, name: "MDS alignment & customization review", check: "UI uses standard MDS components, or every customization is identified, reasoned, risk-assessed, agreed with UI/UX + tech and documented." },
  { id: "AC-01", stage: 1, name: "Acceptance Criteria defined", check: "AC describe the expected behaviour and conditions for acceptance." },
  { id: "AC-02", stage: 1, name: "Gherkin format", check: "AC are written as Given–When–Then scenarios with meaningful steps." },
  { id: "AC-03", stage: 1, name: "Unambiguous and understood", check: "AC are specific and consistent; no ambiguous terms, missing rules or conflicts." },
  { id: "AC-04", stage: 1, name: "Testable and complete", check: "Happy path, alternative flows, validation, errors and boundaries are covered where relevant." },
  { id: "SOL-02", stage: 1, name: "Epic-level high-level solution", check: "The TA has defined the high-level solution at epic level (accessible reference or confirmation)." },
  { id: "SOL-03", stage: 2, name: "Technical dependencies identified", check: "Technical dependencies, integration impacts, affected systems and constraints are identified." },
  { id: "SOL-06", stage: 2, name: "Technical questions resolved", check: "No open technical question or decision blocks starting development." },
] as const;

export type DorId = (typeof DOR_CRITERIA)[number]["id"];
export const DOR_IDS = DOR_CRITERIA.map((c) => c.id) as [DorId, ...DorId[]];
export const DOR_STATUSES = ["pass", "partial", "fail", "not_verifiable", "na"] as const;
export type DorStatus = (typeof DOR_STATUSES)[number];
export type DorStage = "needs_backlog_refinement" | "ready_for_technical_refinement";

export const dorPassed = (s: DorStatus) => s === "pass" || s === "na";

/** Stage per the DoR workflow: every Stage 1 criterion must pass before Technical Refinement. */
export function dorStage(items: { id: DorId; status: DorStatus }[]): DorStage {
  const status = new Map(items.map((i) => [i.id, i.status]));
  return DOR_CRITERIA.every((c) => c.stage !== 1 || dorPassed(status.get(c.id) ?? "not_verifiable"))
    ? "ready_for_technical_refinement"
    : "needs_backlog_refinement";
}
