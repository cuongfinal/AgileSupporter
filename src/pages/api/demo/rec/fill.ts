import { z } from "zod";
import { api, body } from "@/server/api";
import { fillPlaceholders } from "@/server/recorder/store";
import { safeName } from "@/server/store";

export default api({
  POST: async (req) => {
    const b = body(req, z.object({ key: z.string(), values: z.record(z.string(), z.string().max(200)) }));
    return fillPlaceholders(safeName(b.key), b.values);
  },
});
