import { z } from "zod";
import { api, body } from "@/server/api";
import { repoStatus, validateRepoPath } from "@/server/repos";

export default api({
  POST: async (req) => {
    const { path } = body(req, z.object({ path: z.string() }));
    const v = await validateRepoPath(path.trim());
    return v.ok ? { ...v, status: await repoStatus(v.root) } : v;
  },
});
