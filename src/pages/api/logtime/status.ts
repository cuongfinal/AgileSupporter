import { api } from "@/server/api";
import { checkReady } from "@/server/timeTracker";

export default api({
  GET: async (_req, res) => {
    res.setHeader("Cache-Control", "no-store");
    return checkReady();
  },
});