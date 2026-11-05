import { api, HttpError, query } from "@/server/api";
import { getRepo, listBranches } from "@/server/repos";

export default api({
  GET: async (req) => {
    const repo = getRepo(query(req, "key"));
    if (!repo.path) throw new HttpError(400, "Set the repo path first");
    return listBranches(repo.path);
  },
});
