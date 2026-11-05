import { z } from "zod";
import { api, body } from "@/server/api";
import { startRetroJob } from "@/server/retro";

export default api({
  POST: async (req) => {
    const b = body(req, z.object({ sprintId: z.number().int().positive(), notes: z.string().max(5000).optional() }));
    return startRetroJob(b.sprintId, b.notes ?? "");
  },
});
