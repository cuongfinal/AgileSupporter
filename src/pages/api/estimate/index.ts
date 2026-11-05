import { api } from "@/server/api";
import { deleteAllEstimates, listEstimates } from "@/server/estimate";

export default api({
  GET: async () =>
    listEstimates().map((e) => ({
      key: e.key,
      title: e.title,
      type: e.type,
      points: e.points,
      jiraPoints: e.jiraPoints,
      confidence: e.confidence,
      estimatedAt: e.estimatedAt,
      codeAware: e.codeAware,
    })),
  DELETE: async () => ({ deleted: deleteAllEstimates() }),
});
