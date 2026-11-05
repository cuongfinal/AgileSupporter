import { useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { useJob } from "@/lib/client";
import { useT } from "@/lib/i18n";
import { restoreJobs, type TrackedJob, useJobTracker } from "@/lib/jobTracker";
import { toast } from "@/lib/toast";

function Watch({ tracked }: { tracked: TrackedJob }) {
  const qc = useQueryClient();
  const { t } = useT();
  const finish = useJobTracker((s) => s.finish);
  const job = useJob(tracked.id);
  const status = job.data?.status;
  const lost = job.isError;

  useEffect(() => {
    if (lost) {
      finish(tracked.id);
      return;
    }
    if (!status || status === "running") return;
    finish(tracked.id);
    const demo = tracked.kind.startsWith("demo-");
    if (tracked.kind === "retro") for (const key of [["retro"], ["usage"]]) void qc.invalidateQueries({ queryKey: key });
    else if (demo) for (const key of [["draft"], ["builds"], ["usage"], ["rec"]]) void qc.invalidateQueries({ queryKey: key });
    else {
      for (const k of tracked.keys) {
        void qc.invalidateQueries({ queryKey: ["ticket", k] });
        void qc.invalidateQueries({ queryKey: ["estimate", k] });
      }
      for (const key of [["sprint"], ["search"], ["usage"], ["estimates"], ["my-tasks"]]) void qc.invalidateQueries({ queryKey: key });
    }
    const failed = Object.entries(job.data?.items ?? {}).filter(([, v]) => v.status === "error");
    const label = tracked.keys.length === 1 ? tracked.keys[0] : t("job.nTickets", { n: tracked.keys.length });
    const msg = {
      summary: ["summary.failed", "job.summaryDone"],
      review: ["review.failed", "job.reviewDone"],
      spec: ["spec.failed", "job.specDone"],
      tests: ["tests.failed", "job.testsDone"],
      estimate: ["estimate.failed", "job.estimateDone"],
      "demo-draft": ["demo.draftFailed", "job.draftDone"],
      "demo-build": ["demo.buildFailed", "job.buildDone"],
      "demo-pdf": ["common.failed", "job.pdfDone"],
      "demo-flow": ["rec.flowFailed", "job.flowDone"],
      "demo-record": ["rec.recordFailed", "job.recordDone"],
      "demo-setup": ["common.failed", "job.setupDone"],
      retro: ["retro.failed", "job.retroDone"],
      "my-done": ["myDone.failed", "job.myDoneDone"],
    } as const;
    const [failKey, okKey] = msg[tracked.kind];
    if (status === "error" || failed.length)
      toast.error(t(failKey), job.data?.error ?? failed.map(([k, v]) => `${k}: ${v.error}`).join("\n"));
    else toast.success(t(okKey, { what: label }));
  }, [status, lost]); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}

/** Mounted once in _app: polls every unfinished job and refreshes data + toasts when it ends, wherever the user is. */
export default function JobWatcher() {
  const jobs = useJobTracker((s) => s.jobs);
  useEffect(() => restoreJobs(), []);
  return (
    <>
      {jobs
        .filter((j) => !j.finished)
        .map((j) => (
          <Watch key={j.id} tracked={j} />
        ))}
    </>
  );
}
