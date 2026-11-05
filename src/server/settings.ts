import fs from "node:fs";
import path from "node:path";
import type { PublicSettings, Settings } from "@/lib/types";
import { DATA_HOME, detectWorkspaceRoot } from "./paths";
import { secretStatus } from "./secrets";
import { readJson, writeJson } from "./store";

const DEFAULT_REPOS = [
  { key: "frontend", label: "Frontend", dir: "", enabled: true },
  { key: "backend", label: "Backend", dir: "", enabled: true },
  { key: "bff", label: "BFF", dir: "", enabled: true },
  { key: "protobuf", label: "Protobuf", dir: "", enabled: false },
];

function defaults(): Settings {
  const root = detectWorkspaceRoot(DEFAULT_REPOS.map((r) => r.dir).filter(Boolean));
  return {
    jira: {
      baseUrl: "",
      email: "",
      boardId: "",
      projectKey: "",
      spField: "",
      acField: "",
      flaggedField: "",
      aiActionField: "",
      aiScoreField: "",
      aiActionValue: "",
    },
    ai: { provider: "claude", claudeBin: "", copilotBin: "", claudeModel: "", copilotModel: "", concurrency: 2 },
    repos: DEFAULT_REPOS.map((r) => {
      const guess = root && r.dir ? path.join(root, r.dir) : "";
      return { ...r, path: guess && fs.existsSync(path.join(guess, ".git")) ? guess : "" };
    }),
    workspaceRoot: root,
    demo: { testLinkTemplate: "", activeTemplateId: "" },
    glossary: [],
    recording: {
      appUrl: "",
      browser: "chrome",
      width: 1440,
      height: 900,
      tts: {
        provider: "openai",
        openaiModel: "gpt-4o-mini-tts",
        openaiVoice: "alloy",
        elevenModel: "eleven_multilingual_v2",
        elevenVoiceId: "",
        instructions: "Calm, clear product-demo presenter. Moderate pace.",
        macVoice: "Samantha",
      },
    },
    // Recording is opt-in: it drives a real browser on a test environment and uses a paid TTS API.
    features: { figma: true, usage: true, recording: false, jiraWrite: false },
  };
}

export function getSettings(): Settings {
  const d = defaults();
  const saved = readJson<Partial<Settings>>("settings.json", {});
  return {
    ...d,
    ...saved,
    jira: { ...d.jira, ...saved.jira },
    ai: { ...d.ai, ...saved.ai },
    demo: { ...d.demo, ...saved.demo },
    recording: { ...d.recording, ...saved.recording, tts: { ...d.recording.tts, ...saved.recording?.tts } },
    features: { ...d.features, ...saved.features },
    repos: saved.repos?.length ? saved.repos : d.repos,
    glossary: saved.glossary ?? d.glossary,
    workspaceRoot: saved.workspaceRoot || d.workspaceRoot,
  };
}

export function updateSettings(patch: Partial<Settings>): Settings {
  const cur = getSettings();
  const next: Settings = {
    ...cur,
    ...patch,
    jira: { ...cur.jira, ...patch.jira },
    ai: { ...cur.ai, ...patch.ai },
    demo: { ...cur.demo, ...patch.demo },
    recording: { ...cur.recording, ...patch.recording, tts: { ...cur.recording.tts, ...patch.recording?.tts } },
    features: { ...cur.features, ...patch.features },
  };
  next.recording.appUrl = next.recording.appUrl.trim().replace(/\/+$/, "");
  next.jira.baseUrl = next.jira.baseUrl.replace(/\/+$/, "");
  next.ai.concurrency = Math.min(4, Math.max(1, Number(next.ai.concurrency) || 2));
  writeJson("settings.json", next);
  return next;
}

export function publicSettings(): PublicSettings {
  return { ...getSettings(), secrets: secretStatus(), dataHome: DATA_HOME };
}

/** Skills ship inside the app (`skills/`) so any dev can run it without the workspace `.claude/` folder. */
export function skillsDir(): string {
  return path.join(process.cwd(), "skills");
}
