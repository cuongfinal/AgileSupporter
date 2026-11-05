import { z } from "zod";
import { api, body } from "@/server/api";
import { startDraftJob } from "@/server/demo";

export default api({
  POST: async (req) => {
    const b = body(req, z.object({ keys: z.array(z.string()).min(1).max(40), sprintId: z.number().nullable(), sprintName: z.string() }));
    return startDraftJob(b.keys, { id: b.sprintId, name: b.sprintName });
  },
});
