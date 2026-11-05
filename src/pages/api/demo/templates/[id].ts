import { z } from "zod";
import { api, body, query } from "@/server/api";
import { activateTemplate, deleteTemplate, listTemplates, reinspectTemplate } from "@/server/demo";

export default api({
  PUT: async (req) => {
    const id = query(req, "id");
    const { action } = body(req, z.object({ action: z.enum(["activate", "inspect"]) }));
    if (action === "activate") activateTemplate(id);
    else await reinspectTemplate(id);
    return listTemplates();
  },
  DELETE: async (req) => {
    deleteTemplate(query(req, "id"));
    return listTemplates();
  },
});
