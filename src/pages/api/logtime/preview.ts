import { api, query } from "@/server/api";
import { preview } from "@/server/timeTracker";

export default api({ GET: async (req) => preview(query(req, "from"), query(req, "to")) });
