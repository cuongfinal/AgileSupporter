import { api, query } from "@/server/api";
import { figmaPreviews } from "@/server/figma";
import { getIssue } from "@/server/jira";
import { safeName } from "@/server/store";

export default api({
  GET: async (req) => {
    const t = await getIssue(safeName(query(req, "key")));
    return figmaPreviews(t.figmaLinks);
  },
});
