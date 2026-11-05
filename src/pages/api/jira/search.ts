import { api, HttpError, query } from "@/server/api";
import { searchTickets } from "@/server/jira";
import { decorate } from "@/server/tickets";

export default api({
  GET: async (req) => {
    const jql = query(req, "jql").trim();
    if (!jql) throw new HttpError(400, "JQL is empty");
    return decorate(await searchTickets(jql, 200));
  },
});
