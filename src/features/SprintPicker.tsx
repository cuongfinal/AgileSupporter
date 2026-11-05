
import Link from "next/link";
import { useEffect } from "react";
import { Select } from "@/components/Select";
import { type MessageKey, useT } from "@/lib/i18n";
import { useSprintPick, useSprints } from "@/lib/queries";

export default function SprintPicker() {
  const { t } = useT();
  const sprints = useSprints();
  const { sprintId, setSprintId } = useSprintPick();

  useEffect(() => {
    const list = sprints.data;
    if (!list?.length) return;
    if (sprintId === null || !list.some((s) => s.id === sprintId)) setSprintId((list.find((s) => s.state === "active") ?? list[0]).id);
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
