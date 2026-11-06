
import Link from "next/link";
import { useEffect } from "react";
import { Segmented, SegmentedItem } from "@/components/kit";
import { Select } from "@/components/Select";
import { type MessageKey, useT } from "@/lib/i18n";
import { useSprintPick, useSprints } from "@/lib/queries";
import { currentSprint, nextSprint } from "@/lib/sprints";

export default function SprintPicker() {
  const { t } = useT();
  const sprints = useSprints();
  const { sprintId, setSprintId } = useSprintPick();

  useEffect(() => {
    const list = sprints.data;
    if (!list?.length) return;
    if (sprintId === null || !list.some((s) => s.id === sprintId)) setSprintId((currentSprint(list) ?? list[0]).id);
  }, [sprints.data, sprintId, setSprintId]);

  if (sprints.error)
    return (
      <Link href="/settings#jira" className="text-sm text-ui-error" title={(sprints.error as Error).message}>
        {t("sprint.configureJira")}
      </Link>
    );
  return (
    <div className="w-80">
      <Select
        size="sm"
        loading={sprints.isLoading}
        placeholder={t("sprint.pick")}
        items={(sprints.data ?? []).map((s) => ({ value: String(s.id), label: `${s.name} · ${t(`sprintState.${s.state}` as MessageKey)}` }))}
        value={sprintId !== null ? [String(sprintId)] : []}
        onValueChange={(v) => v[0] && setSprintId(Number(v[0]))}
      />
    </div>
  );
}

/** One click between the current sprint and the next one (to look ahead before it starts). */
export function SprintQuickSwitch() {
  const { t } = useT();
  const sprints = useSprints();
  const { sprintId, setSprintId } = useSprintPick();
  const list = sprints.data ?? [];
  const cur = currentSprint(list);
  const next = nextSprint(list);
  if (!cur || !next) return null;
  const options = [cur, next];
  return (
    <Segmented
      size="sm"
      aria-label={t("sprint.quickSwitch")}
      selectedIndex={options.findIndex((s) => s.id === sprintId)}
      onChange={(i) => setSprintId(options[i].id)}
    >
      <SegmentedItem>{t("sprint.currentShort", { name: cur.name })}</SegmentedItem>
      <SegmentedItem>{t("sprint.nextShort", { name: next.name })}</SegmentedItem>
    </Segmented>
  );
}
