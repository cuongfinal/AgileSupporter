import { z } from "zod";
import { api, body } from "@/server/api";
import { logTime } from "@/server/timeTracker";

export default api({
  POST: async (req) => {
    const b = body(req, z.object({ dates: z.array(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)).min(1).max(62) }));
    return logTime(b.dates);
  },
});
