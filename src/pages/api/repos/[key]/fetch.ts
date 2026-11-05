import { api, HttpError, query } from "@/server/api";
import { fetchRepo, getRepo } from "@/server/repos";

export default api({
  POST: async (req) => {
    const repo = getRepo(query(req, "key"));
    if (!repo.path) throw new HttpError(400, "Set the repo path first");
    const r = await fetchRepo(repo.path);
    if (!r.ok) throw new HttpError(502, r.message);
    return r;
  },
});
