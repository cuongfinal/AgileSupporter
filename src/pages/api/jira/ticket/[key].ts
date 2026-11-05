import { api, query } from "@/server/api";
import { latestReview, latestSpec, latestSummary, latestTests, specStaleness, staleness, workspaceSpecPath } from "@/server/analysis";
import { getIssue } from "@/server/jira";
import { markViewed } from "@/server/snapshots";
import { safeName } from "@/server/store";

export default api({
  GET: async (req) => {
    const key = safeName(query(req, "key"));
    const ticket = await getIssue(key);
    const review = latestReview(key);
    const spec = latestSpec(key);
    const tests = latestTests(key);
    return {
      ticket,
      summary: latestSummary(key),
      review,
      spec,
      tests,
      stale: {
        review: staleness(ticket, review, review?.reviewedAt),
        spec: specStaleness(ticket, spec),
        tests: staleness(ticket, tests, tests?.generatedAt),
      },
      specTarget: workspaceSpecPath(key),
      snapshot: markViewed(ticket),
    };
  },
});
