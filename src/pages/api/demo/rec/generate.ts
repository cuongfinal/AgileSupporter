import { z } from "zod";
import { api, body } from "@/server/api";
import { startFlowJob } from "@/server/recorder";
import { safeName } from "@/server/store";

export default api({
  POST: async (req) => {
    const b = body(req, z.object({ keys: z.array(z.string()).min(1).max(20) }));
    b.keys.forEach(safeName);
    return startFlowJob(b.keys);
  },
});
