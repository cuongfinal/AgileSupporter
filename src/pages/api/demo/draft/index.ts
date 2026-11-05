import { z } from "zod";
import { api, body } from "@/server/api";
import { getDraft, renderScript, saveDraft } from "@/server/demo";

const story = z.object({
  key: z.string(),
  title: z.string(),
  tag: z.string(),
  status: z.string(),
  headline: z.tuple([z.string(), z.string()]),
  purpose: z.string(),
  why: z.string(),
  improving: z.string(),
  scenarios: z.array(z.object({ name: z.string(), steps: z.array(z.string()) })),
  testIds: z.string(),
});
const draft = z.object({
  sprintId: z.number().nullable(),
  sprintName: z.string(),
  glanceTitle: z.string(),
  stories: z.array(story),
  updatedAt: z.string(),
});

export default api({
  GET: async () => {
    const d = getDraft();
    return { draft: d, script: renderScript(d) };
  },
  PUT: async (req) => {
    const d = saveDraft(body(req, draft));
    return { draft: d, script: renderScript(d) };
  },
});
