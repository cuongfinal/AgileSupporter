import { api, query } from "@/server/api";
import { deleteEstimate, estimateView } from "@/server/estimate";
import { safeName } from "@/server/store";

export default api({
  GET: async (req) => estimateView(safeName(query(req, "key"))),
  DELETE: async (req) => {
    deleteEstimate(safeName(query(req, "key")));
    return { ok: true };
  },
});
