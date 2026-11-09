import { Spinner, Tag } from "@/components/kit";
import Link from "next/link";
import { useT } from "@/lib/i18n";
import { useRepoStatus, useSettings } from "@/lib/queries";
import type { RepoConfig } from "@/lib/types";

function RepoBadge({ repo }: { repo: RepoConfig }) {
  const st = useRepoStatus(repo.key);
  const { t } = useT();
  if (st.isLoading) return <Spinner size="sm" />;
  if (!st.data?.ok)
    return (
      <Tag size="sm" color="red" variant="light">
        {repo.label}: {t("repos.invalidPath")}
      </Tag>
    );
  return (
    <span className="inline-flex items-center gap-1.5 text-xs">
      <span className="text-ui-subtle">{repo.label}</span>
      <span className="rounded-md bg-ui-brand text-ui-on-solid px-2 py-0.5 font-mono font-semibold">⎇ {st.data.branch}</span>
      {st.data.dirty && <Tag size="sm" color="orange" variant="light">{t("repos.dirty")}</Tag>}
    </span>
  );
}

/** The branches a code-aware review will read right now. */
export default function RepoBadges() {
  const { t } = useT();
  const settings = useSettings();
  const repos = settings.data?.repos.filter((r) => r.enabled && r.path) ?? [];
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs">
      <span className="font-medium text-ui-heading">{t("review.readingFrom")}</span>
      {repos.length ? repos.map((r) => <RepoBadge key={r.key} repo={r} />) : <span className="text-ui-warning-dark">{t("review.noRepos")}</span>}
      <Link href="/settings#repos" className="ml-auto">
        {t("review.changeRepos")}
      </Link>
    </div>
  );
}
