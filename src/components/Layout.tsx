import { Segmented, SegmentedItem, Tooltip, TooltipContent, TooltipTrigger } from "@/components/kit";
import { CalculatorIcon, ChartIcon, ClockIcon, IdeaIcon, ListIcon, ReportIcon, SettingsIcon, TaskIcon } from "@/components/icons";
import Link from "next/link";
import { useRouter } from "next/router";
import { type ReactNode, useEffect } from "react";
import { type MessageKey, restoreLang, useLang, useT } from "@/lib/i18n";
import { restoreSprint, useAiStatus, useSettings } from "@/lib/queries";

const NAV: { href: string; label: MessageKey; icon: ReactNode; feature?: "usage" }[] = [
  { href: "/sprint", label: "nav.sprint", icon: <ListIcon /> },
  { href: "/tasks", label: "nav.tasks", icon: <TaskIcon /> },
  { href: "/estimate", label: "nav.estimate", icon: <CalculatorIcon /> },
  { href: "/demo", label: "nav.demo", icon: <ReportIcon /> },
  { href: "/insights", label: "nav.insights", icon: <ChartIcon /> },
  { href: "/retro", label: "nav.retro", icon: <IdeaIcon /> },
  { href: "/usage", label: "nav.usage", icon: <ClockIcon />, feature: "usage" },
  { href: "/settings", label: "nav.settings", icon: <SettingsIcon /> },
];

function Dot({ ok, label, detail }: { ok: boolean | null; label: string; detail: string }) {
  return (
    <Tooltip placement="bottom">
      <TooltipTrigger asChild>
        <Link href="/settings" className="inline-flex items-center gap-1.5 text-xs text-ui-subtle no-underline hover:text-ui-brand">
          <span
            className={`w-2 h-2 rounded-full ${ok === null ? "bg-ui-muted" : ok ? "bg-ui-success" : "bg-ui-error"}`}
            aria-hidden
          />
          {label}
        </Link>
      </TooltipTrigger>
      <TooltipContent>{detail}</TooltipContent>
    </Tooltip>
  );
}

export default function Layout({ children }: { children: ReactNode }) {
  const router = useRouter();
  const { t, lang } = useT();
  const setLang = useLang((s) => s.setLang);
  const settings = useSettings();
  const ai = useAiStatus();

  useEffect(() => {
    restoreLang();
    restoreSprint();
  }, []);

  const s = settings.data;
  const jiraOk = s ? s.secrets["jira.token"].set && !!s.jira.email && !!s.jira.boardId : null;
  const cli = ai.data?.find((c) => c.provider === s?.ai.provider);
  const aiOk = ai.data && s ? !!cli?.found : null;
  const repoCount = s ? s.repos.filter((r) => r.enabled && r.path).length : 0;

  return (
    <div className="min-h-screen flex flex-col">
      <header className="h-14 bg-white border-b border-ui-border flex items-center justify-between px-5 sticky top-0 z-20">
        <Link href="/sprint" className="flex items-center gap-2 no-underline">
          <span className="w-7 h-7 rounded-md bg-ui-brand text-white grid place-items-center font-bold text-sm">D</span>
          <span className="font-semibold text-ui-primary">INTERNAL DEV DASHBOARD</span>
        </Link>
        <div className="flex items-center gap-5">
          <div className="hidden md:flex items-center gap-4">
            <Dot ok={jiraOk} label="Jira" detail={jiraOk ? t("header.jiraOk") : t("header.jiraMissing")} />
            <Dot
              ok={aiOk}
              label={s?.ai.provider === "copilot" ? "Copilot" : "Claude"}
              detail={cli?.found ? cli.version : t("header.aiMissing")}
            />
            <Dot ok={s ? repoCount > 0 : null} label={t("header.repos", { n: repoCount })} detail={t("header.reposDetail")} />
          </div>
          <Segmented size="sm" selectedIndex={lang === "en" ? 0 : 1} onChange={(i) => setLang(i === 0 ? "en" : "vi")} aria-label={t("header.language")}>
            <SegmentedItem>EN</SegmentedItem>
            <SegmentedItem>VI</SegmentedItem>
          </Segmented>
        </div>
      </header>
      <div className="flex flex-1 min-h-0">
        <nav className="w-52 shrink-0 bg-white border-r border-ui-border hidden sm:block" aria-label="Main">
          <ul className="list-none m-0 py-4 px-0 space-y-0.5 sticky top-14">
            {NAV.filter((n) => !n.feature || s?.features[n.feature] !== false).map((n) => {
              const active = router.pathname.startsWith(n.href);
              return (
                <li key={n.href}>
                  <Link
                    href={n.href}
                    aria-current={active ? "page" : undefined}
                    className={`flex items-center gap-3 mx-2 px-3 py-2 rounded-md text-sm no-underline border-l-[3px] ${
                      active
                        ? "bg-ui-brand-surface text-ui-brand font-semibold border-ui-brand"
                        : "text-ui-body border-transparent hover:bg-ui-surface"
                    }`}
                  >
                    <span className="w-5 h-5 grid place-items-center [&_svg]:w-5 [&_svg]:h-5">{n.icon}</span>
                    {t(n.label)}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
        <main className="flex-1 min-w-0 p-6 max-w-[1400px]">{children}</main>
      </div>
    </div>
  );
}
