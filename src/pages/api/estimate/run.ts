import { z } from "zod";
import { api, body } from "@/server/api";
import { startEstimateBatch } from "@/server/estimate";

export default api({
  POST: async (req) => {
    const b = body(req, z.object({ keys: z.array(z.string()).min(1).max(20), force: z.boolean().optional(), code: z.boolean().optional() }));
    return startEstimateBatch(b.keys, !!b.force, b.code !== false);
  },
});
