import { z } from "zod";
import { api, body, HttpError, query } from "@/server/api";
import { getRepo, repoStatus, switchBranch } from "@/server/repos";

export default api({
  POST: async (req) => {
    const repo = getRepo(query(req, "key"));
    if (!repo.path) throw new HttpError(400, "Set the repo path first");
    const { branch } = body(req, z.object({ branch: z.string().min(1) }));
    const r = await switchBranch(repo.path, branch);
    if (!r.ok) throw new HttpError(409, r.message);
    return { ...r, status: await repoStatus(repo.path) };
  },
});
