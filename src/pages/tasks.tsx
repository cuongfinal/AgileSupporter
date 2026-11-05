import { PageHeader, ReloadButton } from "@/components/ui";
import SprintPicker from "@/features/SprintPicker";
import TaskMover from "@/features/TaskMover";
import { useT } from "@/lib/i18n";
import { useSprintPick } from "@/lib/queries";

export default function TasksPage() {
  const { t } = useT();
  const { sprintId } = useSprintPick();
  return (
    <>
      <PageHeader
        title={t("nav.tasks")}
        subtitle={t("myDone.subtitle")}
        actions={
          <>
            <ReloadButton keys={["my-tasks"]} />
            <SprintPicker />
          </>
        }
      />
      {sprintId !== null && <TaskMover sprintId={sprintId} />}
    </>
  );
}
