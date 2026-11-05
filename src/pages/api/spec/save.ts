import { z } from "zod";
import { api, body } from "@/server/api";
import { saveSpecToWorkspace } from "@/server/analysis";

export default api({
  POST: async (req) => {
    const b = body(req, z.object({ key: z.string(), overwrite: z.boolean().optional() }));
    return saveSpecToWorkspace(b.key, !!b.overwrite);
  },
});
