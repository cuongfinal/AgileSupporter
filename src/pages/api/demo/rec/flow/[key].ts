import { z } from "zod";
import { api, body, query } from "@/server/api";
import { deleteFlow, flowSchema, getFlow, saveFlow } from "@/server/recorder/store";
import { safeName } from "@/server/store";

export default api({
  GET: async (req) => getFlow(safeName(query(req, "key"))),
  PUT: async (req) => {
    const key = safeName(query(req, "key"));
    const b = body(req, z.object({ flow: flowSchema, approved: z.boolean() }));
    return saveFlow(key, b.flow, { approved: b.approved });
  },
  DELETE: async (req) => {
    deleteFlow(safeName(query(req, "key")));
    return { ok: true };
  },
});
