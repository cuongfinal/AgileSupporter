import { z } from "zod";
import { api, body } from "@/server/api";
import { refinementChecklist } from "@/server/analysis";
import { searchTickets } from "@/server/jira";
import { safeName } from "@/server/store";

export default api({
  POST: async (req) => {
    const { keys } = body(req, z.object({ keys: z.array(z.string()).min(1).max(200) }));
    keys.forEach(safeName);
    const found = await searchTickets(`key in (${keys.join(",")})`, 200);
    const ordered = keys.map((k) => found.find((t) => t.key === k)).filter((t) => !!t);
    return { markdown: refinementChecklist(ordered) };
  },
});
