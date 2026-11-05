import { api, query } from "@/server/api";
import { deleteBuild, listBuilds } from "@/server/demo";

export default api({
  DELETE: async (req) => {
    deleteBuild(query(req, "id"));
    return listBuilds();
  },
});
