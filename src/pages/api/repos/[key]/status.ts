import { api, query } from "@/server/api";
import { getRepo, repoStatus, suggestPath } from "@/server/repos";

export default api({
  GET: async (req) => {
    const repo = getRepo(query(req, "key"));
    if (!repo.path) return { ok: false, error: "no_path", suggestion: suggestPath(repo.dir) };
    return repoStatus(repo.path);
  },
});
