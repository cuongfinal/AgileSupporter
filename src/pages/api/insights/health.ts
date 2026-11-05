import { api, HttpError, query } from "@/server/api";
import { sprintHealth } from "@/server/insights";

export default api({
  GET: async (req) => {
    const id = Number(query(req, "sprintId"));
    if (!Number.isInteger(id)) throw new HttpError(400, "Pick a sprint");
    return sprintHealth(id);
  },
});
