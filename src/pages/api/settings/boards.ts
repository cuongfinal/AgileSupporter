import { api, query } from "@/server/api";
import { listBoards } from "@/server/jira";

export default api({ GET: async (req) => listBoards(query(req, "q")) });
