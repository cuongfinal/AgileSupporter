import { api, HttpError, query } from "@/server/api";
import { myTasks } from "@/server/myTasks";

export default api({
  GET: async (req) => {
    const id = Number(query(req, "sprintId"));
    if (!Number.isInteger(id) || id <= 0) throw new HttpError(400, "Pick a sprint");
    // assignees absent → only me; "all" → everyone; else comma-separated account ids.
    const raw = query(req, "assignees");
    const assignees = !raw ? null : raw === "all" ? [] : raw.split(",").filter((a) => /^[\w:-]{1,128}$/.test(a));
    return myTasks(id, assignees);
  },
});
