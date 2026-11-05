import { api } from "@/server/api";
import { readUsage } from "@/server/ai";

export default api({
  GET: async () => {
    const entries = readUsage();
    const byDay = new Map<string, { day: string; runs: number; cacheHits: number; failures: number; ms: number; costUsd: number }>();
    for (const e of entries) {
      const day = e.ts.slice(0, 10);
      const d = byDay.get(day) ?? { day, runs: 0, cacheHits: 0, failures: 0, ms: 0, costUsd: 0 };
      if (e.provider === "cache") d.cacheHits++;
      else d.runs++;
      if (!e.ok) d.failures++;
      d.ms += e.ms;
      d.costUsd += e.costUsd ?? 0;
      byDay.set(day, d);
    }
    return { days: [...byDay.values()].sort((a, b) => b.day.localeCompare(a.day)).slice(0, 30), recent: entries.slice(-50).reverse() };
  },
});
