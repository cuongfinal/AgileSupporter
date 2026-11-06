import { z } from "zod";
import { api, body } from "@/server/api";
import { publicSettings, updateSettings } from "@/server/settings";

const patch = z
  .object({
    jira: z
      .object({
        baseUrl: z.union([z.literal(""), z.string().url()]),
        email: z.string(),
        boardId: z.string().regex(/^\d*$/, "Board ID must be a number"),
        projectKey: z.string(),
        spField: z.string(),
        acField: z.string(),
        flaggedField: z.string(),
        aiActionField: z.string().max(200),
        aiScoreField: z.string().max(200),
        aiActionValue: z.string().max(200),
      })
      .partial(),
    ai: z
      .object({
        provider: z.enum(["claude", "copilot"]),
        claudeBin: z.string(),
        copilotBin: z.string(),
        claudeModel: z.string(),
        copilotModel: z.string(),
        concurrency: z.number().int().min(1).max(4),
      })
      .partial(),
    repos: z.array(z.object({ key: z.string(), label: z.string(), dir: z.string(), path: z.string(), enabled: z.boolean() })),
    workspaceRoot: z.string(),
    demo: z.object({ testLinkTemplate: z.string(), activeTemplateId: z.string() }).partial(),
    glossary: z.array(z.object({ term: z.string().min(1), en: z.string(), vi: z.string(), keep: z.boolean() })),
    features: z.object({ figma: z.boolean(), usage: z.boolean(), recording: z.boolean(), jiraWrite: z.boolean(), logTime: z.boolean() }).partial(),
    timeTracker: z
      .object({
        baseUrl: z.union([z.literal(""), z.string().url()]),
        userId: z.string().regex(/^\d*$/, "User ID must be a number"),
        loginName: z.string().max(200),
        mainTaskId: z.string().regex(/^\d*$/, "Task ID must be a number"),
        kaizenTaskId: z.string().regex(/^\d*$/, "Task ID must be a number"),
        slots: z
          .array(z.object({ start: z.string().regex(/^\d{2}:\d{2}$/), end: z.string().regex(/^\d{2}:\d{2}$/), task: z.enum(["main", "kaizen"]) }))
          .max(12),
      })
      .partial(),
    recording: z
      .object({
        appUrl: z.string().url().or(z.literal("")),
        browser: z.enum(["chrome", "chromium"]),
        width: z.number().int().min(800).max(2560),
        height: z.number().int().min(600).max(1600),
        tts: z
          .object({
            provider: z.enum(["openai", "elevenlabs", "macos"]),
            openaiModel: z.string(),
            openaiVoice: z.string(),
            elevenModel: z.string(),
            elevenVoiceId: z.string(),
            instructions: z.string().max(500),
            macVoice: z.string().max(80),
          })
          .partial(),
      })
      .partial(),
  })
  .partial();

export default api({
  GET: async () => publicSettings(),
  PUT: async (req) => {
    updateSettings(body(req, patch) as Parameters<typeof updateSettings>[0]);
    return publicSettings();
  },
});
