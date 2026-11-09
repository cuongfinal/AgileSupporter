import { api } from "@/server/api";
import { myTasks } from "@/server/timeTracker";

export default api({
  GET: async (_req, res) => {
    res.setHeader("Cache-Control", "no-store");
    return myTasks();
  },
});
