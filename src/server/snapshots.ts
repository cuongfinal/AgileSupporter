import type { Snapshot, Ticket } from "@/lib/types";
import { readJson, safeName, writeJson } from "./store";

interface SnapshotFile {
  current: Snapshot;
  previous: Snapshot | null;
}

const file = (key: string) => `snapshots/${safeName(key)}.json`;

function toSnap(t: Ticket): Snapshot {
  return { updated: t.updated, summary: t.summary, descriptionMd: t.descriptionMd, acMd: t.acMd, viewedAt: new Date().toISOString() };
}

export function hasUnseenChange(t: Ticket): boolean {
  const s = readJson<SnapshotFile | null>(file(t.key), null);
  return !!s && s.current.updated !== t.updated;
}

/** Records a view; when the ticket changed since the last view, the old version becomes `previous`. */
export function markViewed(t: Ticket): SnapshotFile {
  const s = readJson<SnapshotFile | null>(file(t.key), null);
  let next: SnapshotFile;
  if (!s) next = { current: toSnap(t), previous: null };
  else if (s.current.updated !== t.updated) next = { current: toSnap(t), previous: s.current };
  else next = { ...s, current: { ...s.current, viewedAt: new Date().toISOString() } };
  writeJson(file(t.key), next);
  return next;
}
