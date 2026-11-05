import { api, HttpError, query } from "@/server/api";
import { getJob } from "@/server/jobs";

export default api({
  GET: async (req) => {
    const job = getJob(query(req, "id"));
    if (!job) throw new HttpError(404, "Job not found (the server may have restarted)");
    return job;
  },
});
