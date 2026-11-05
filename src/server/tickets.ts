import type { SprintTicket, Ticket } from "@/lib/types";
import { latestReview, latestSummary, staleness } from "./analysis";
import { hasUnseenChange } from "./snapshots";

export function decorate(tickets: Ticket[]): SprintTicket[] {
  return tickets.map((t) => {
    const r = latestReview(t.key);
    const count = (sev: string) => r?.findings.filter((f) => f.severity === sev).length ?? 0;
    return {
      ...t,
      unseenChange: hasUnseenChange(t),
      hasSummary: !!latestSummary(t.key),
      review: r ? { high: count("high"), medium: count("medium"), low: count("low") } : null,
      // The list only flags real content changes; "maybe" (old record + newer timestamp) is shown in the drawer.
      reviewStale: staleness(t, r, r?.reviewedAt)?.state === "stale" ? { state: "stale", reason: "content" } : null,
    };
  });
}
