import { api, query } from "@/server/api";
import { startPdfJob } from "@/server/demo";

export default api({ POST: async (req) => startPdfJob(query(req, "id")) });
