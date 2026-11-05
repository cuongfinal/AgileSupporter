import { z } from "zod";
import { api, body } from "@/server/api";
import { startBuildJob } from "@/server/demo";

export default api({
  POST: async (req) => {
    const b = body(req, z.object({ keys: z.array(z.string()).nullable().optional(), screenshots: z.boolean().optional() }));
    return startBuildJob(b.keys ?? null, { screenshots: !!b.screenshots });
  },
});
