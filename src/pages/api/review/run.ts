import { z } from "zod";
import { api, body } from "@/server/api";
import { startBatch } from "@/server/analysis";

export default api({
  POST: async (req) => {
    const b = body(req, z.object({ keys: z.array(z.string()).min(1).max(100), force: z.boolean().optional() }));
    return startBatch("review", b.keys, !!b.force);
  },
});
