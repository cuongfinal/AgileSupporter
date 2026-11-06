import type { Sprint } from "./types";

const start = (s: Sprint) => s.startDate ?? "";

/** The running sprint; between sprints, the one that ended last. */
export function currentSprint(list: Sprint[]): Sprint | undefined {
  return (
    list.find((s) => s.state === "active") ??
    [...list].filter((s) => s.state === "closed").sort((a, b) => start(b).localeCompare(start(a)))[0] ??
    list[0]
  );
}

/** The soonest sprint that hasn't started (no start date yet sorts last, then by id). */
export function nextSprint(list: Sprint[]): Sprint | undefined {
  return [...list]
    .filter((s) => s.state === "future")
    .sort((a, b) => (start(a) || "9999").localeCompare(start(b) || "9999") || a.id - b.id)[0];
}
