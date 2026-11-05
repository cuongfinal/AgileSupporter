import { z } from "zod";
import { api, body } from "@/server/api";
import { runAi } from "@/server/ai";

export default api({
  POST: async (req) => {
    const { provider } = body(req, z.object({ provider: z.enum(["claude", "copilot"]) }));
    const r = await runAi({
      task: "test",
      provider,
      prompt: 'Connection test. Reply with ok=true and greeting set to "xin chào".',
      schema: z.object({ ok: z.boolean(), greeting: z.string() }),
      timeoutMs: 90000,
    });
    return { ok: r.data.ok, greeting: r.data.greeting, ms: r.ms, costUsd: r.costUsd };
  },
});
