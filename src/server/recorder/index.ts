import type { DemoStory } from "@/lib/types";
import { runAi } from "../ai";
import { HttpError } from "../api";
import { getDraft, testLinks } from "../demo";
import { getJob, runPool, startJob } from "../jobs";
import { activeRepos } from "../repos";
import { getSecret } from "../secrets";
import { getSettings } from "../settings";
import { browserReady, chromeInstalled, loginOpen, savedSession } from "./browser";
import { effectiveTts, ffmpegAvailable } from "./media";
import { type RecordOptions, recordStory } from "./player";
import { flowPlaceholders, flowSchema, getFlow, getManifest, saveFlow } from "./store";

function requireEnabled() {
  if (!getSettings().features.recording) throw new HttpError(400, "Demo recording is turned off (Settings → Features).");
}

export async function recordingStatus() {
  const s = getSettings();
  const draft = getDraft();
  return {
    enabled: s.features.recording,
    appUrl: s.recording.appUrl,
    browser: { kind: s.recording.browser, ready: await browserReady(), chrome: chromeInstalled() },
    ffmpeg: ffmpegAvailable(),
    session: { ...savedSession(), loginOpen: loginOpen() },
    tts: {
      provider: s.recording.tts.provider,
      ...(await effectiveTts().then((e) => ({ configured: e.provider !== null, effective: e.provider, fallback: e.fallback }))),
      macVoice: s.recording.tts.macVoice,
      openaiKey: !!(await getSecret("openai.key")),
      elevenKey: !!(await getSecret("elevenlabs.key")),
    },
    stories: Object.fromEntries(
      draft.stories.map((st) => {
        const flow = getFlow(st.key);
        return [st.key, { flow, placeholders: flow ? flowPlaceholders(flow.flow) : [], recording: getManifest(st.key) }];
      }),
    ),
  };
}

function flowPrompt(story: DemoStory, appUrl: string, feDir: string): string {
  const links = testLinks(story);
  return [
    "Write a browser automation FLOW that demonstrates one user story on a web app, for a Sprint Review video.",
    "The flow is replayed with Playwright by a fixed runner; you only output data in the schema (no code).",
    "Read the frontend source (read-only: Read/Grep/Glob, never modify anything) to find the real routes, labels, button texts, " +
      "aria roles and data-testid attributes, so every target actually exists on the page.",
    "",
    "Runner semantics:",
    `- App base URL: ${appUrl}. goto.value is a path relative to it (e.g. "bill-of-lading?blId=ABC123") or an absolute URL on the same origin.`,
    "- Target: by = role (value = ARIA role like button/tab/textbox/link/combobox/checkbox/row, name = accessible name) | text (visible text) | " +
      "label (form label) | placeholder | testId (data-testid) | css (last resort). nth = which match (0 = first). Prefer role+name, then label/testId/text.",
    "- Actions: goto(value) · click(target) · dblclick(target) · fill(target, value) · select(target, value = option label) · press(value = key, target optional) · " +
      "hover(target) · waitFor(target, value = timeout ms or \"\") · scroll(target or value = pixels) · wait(value = ms, ≤ 3000, only when nothing better) · " +
      "resize(value = \"WIDTHxHEIGHT\", e.g. \"1920x1080\") to show responsive layouts.",
    "- The app keeps polling, so the runner only waits for the page load + ~1s after goto and ~0.4s after a click: ALWAYS add a waitFor for " +
      "content that loads late (tables, drawers, edit mode) before using it.",
    "- Selector reliability: role+name only works when the element has a visible <label>, aria-label or text that the code shows. Inputs inside " +
      "tables/grids usually have NO accessible name — target them by css on id/name/data-testid attributes you saw in the code (e.g. " +
      "[name=\"cargoLines.0.manifestFileNo\"]), with nth for the row. Do not guess names from column headers.",
    "- Each scenario that needs a record in a specific state must get its OWN placeholder (e.g. TODO_S1_US_SELF_FILED_BL), so a person can supply " +
      "a different record per scenario.",
    "",
    "Rules:",
    "- One flow scenario per demo scenario below, same order and same names. Steps follow the scenario's bullets; split a bullet if it needs several screens.",
    "- Each scenario starts with a goto, so it can run on its own.",
    "- Use the test data below (B/L numbers / links). Never invent IDs. When an ID is missing, use a placeholder named TODO_<WHAT> in capitals " +
      "(e.g. TODO_MASTER_BL, TODO_HOUSE_BL, TODO_BOOKING_NO) — one name per distinct record, reused wherever that record appears — and say in `notes` " +
      "what kind of record it must be (status, flags). The app asks a person to fill each placeholder before running.",
    "- This runs on a SHARED TEST environment: never delete, cancel, send, submit to external parties, or approve anything. " +
      "If the story's demo needs a save, save only the fields the scenario is about and say so in `notes`.",
    "- narration: what the presenter says during that step — spoken English, first person ('Here I open…', 'Now you can see…'), " +
      "1–2 short sentences, matching the scenario bullets. It is read aloud by text-to-speech, so no markdown, no IDs read character by character.",
    "- screenshot: true on the ONE step per scenario that best shows the result (it goes on the slide).",
    "- notes: assumptions and anything a human should check before running (e.g. needs a B/L in Draft status).",
    "",
    `## Frontend source (read-only): ${feDir}`,
    "",
    `## Story ${story.key} — ${story.title}`,
    `Purpose: ${story.purpose}`,
    `What changed: ${story.improving}`,
    "",
    "## Demo scenarios",
    ...story.scenarios.map((sc, i) => `${i + 1}. ${sc.name}\n${sc.steps.map((st) => `   - ${st}`).join("\n")}`),
    "",
    "## Test data",
    links.length ? links.map((l) => `- ${l.label ? `${l.label}: ` : ""}${l.url}`).join("\n") : "_(none given)_",
  ].join("\n");
}

export function startFlowJob(keys: string[]) {
  requireEnabled();
  return startJob("demo-flow", keys.length, async (ctx) => {
    const { appUrl } = getSettings().recording;
    if (!appUrl) throw new Error("Set the demo app URL first (Settings → Demo recording).");
    const fe = (await activeRepos()).find((r) => r.key === "frontend");
    if (!fe) throw new Error("The frontend repo is not configured (Settings → Source repos) — the AI needs it to find real selectors.");
    const draft = getDraft();
    for (const k of keys) ctx.item(k, "pending");
    let failed = 0;
    await runPool(keys, Math.min(2, getSettings().ai.concurrency), async (key) => {
      ctx.item(key, "running");
      ctx.label(key);
      try {
        const story = draft.stories.find((s) => s.key === key);
        if (!story) throw new Error("Not in the demo draft");
        const { data } = await runAi({
          task: "demo-flow",
          prompt: flowPrompt(story, appUrl, fe.path),
          schema: flowSchema,
          readDirs: [fe.path],
          timeoutMs: 12 * 60_000,
        });
        saveFlow(key, data, { approved: false, generated: true });
        ctx.item(key, "done");
      } catch (e) {
        failed++;
        ctx.item(key, "error", e instanceof Error ? e.message : String(e));
      }
      ctx.step();
    });
    return { failed };
  });
}

const g = globalThis as unknown as { __ddRecording?: boolean };

export function startRecordJob(keys: string[], opts: RecordOptions) {
  requireEnabled();
  if (g.__ddRecording) throw new HttpError(409, "A recording is already running — wait for it to finish.");
  g.__ddRecording = true;
  // One browser at a time: recordings share the login session and the screen timing must not compete for CPU.
  const job = startJob("demo-record", keys.length, async (ctx) => {
    for (const k of keys) ctx.item(k, "pending");
    let failed = 0;
    for (const key of keys) {
      ctx.item(key, "running");
      try {
        const m = await recordStory(key, opts, ctx);
        ctx.item(key, m.ok ? "done" : "error", m.ok ? undefined : `${m.errors.length} step(s) failed: ${m.errors[0]?.message ?? ""}`);
        if (!m.ok) failed++;
      } catch (e) {
        failed++;
        ctx.item(key, "error", e instanceof Error ? e.message : String(e));
      }
      ctx.step();
    }
    return { failed };
  });
  // startJob runs the work in the background; release the lock when it settles.
  void waitForJob(job.id).finally(() => (g.__ddRecording = false));
  return job;
}

async function waitForJob(id: string) {
  for (;;) {
    const j = getJob(id);
    if (!j || j.status !== "running") return;
    await new Promise((r) => setTimeout(r, 1000));
  }
}

export { requireEnabled };
