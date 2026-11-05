import { z } from "zod";
import { api, body } from "@/server/api";
import { startRecordJob } from "@/server/recorder";
import { safeName } from "@/server/store";

export default api({
  POST: async (req) => {
    const b = body(req, z.object({ keys: z.array(z.string()).min(1).max(20), video: z.boolean(), voice: z.boolean() }));
    b.keys.forEach(safeName);
    return startRecordJob(b.keys, { video: b.video, voice: b.video && b.voice });
  },
});
