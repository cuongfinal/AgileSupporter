import { api, HttpError, query } from "@/server/api";
import { sprintIssues } from "@/server/jira";
import { decorate } from "@/server/tickets";

export default api({
  GET: async (req) => {
    const id = Number(query(req, "id"));
    if (!Number.isInteger(id)) throw new HttpError(400, "Invalid sprint id");
    return decorate(await sprintIssues(id));
  },
});
