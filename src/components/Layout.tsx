import { Segmented, SegmentedItem, Tooltip, TooltipContent, TooltipTrigger } from "@/components/kit";
import {
  CalculatorIcon,
  ChartIcon,
  ClockIcon,
  DarkThemeIcon,
  IdeaIcon,
  LightThemeIcon,
  ListIcon,
  ReportIcon,
  SettingsIcon,
  SystemThemeIcon,
  TaskIcon,
  TimerIcon,
} from "@/components/icons";
import Link from "next/link";
import { useRouter } from "next/router";
import { type ReactNode, useEffect } from "react";
import { type MessageKey, restoreLang, useLang, useT } from "@/lib/i18n";
import { restoreSprint, useAiStatus, useSettings } from "@/lib/queries";
import { restoreTheme, type ThemePref, useTheme } from "@/lib/theme";

const NAV: { href: string; label: MessageKey; icon: ReactNode; feature?: "usage" | "logTime" }[] = [
  { href: "/sprint", label: "nav.sprint", icon: <ListIcon /> },
  { href: "/tasks", label: "nav.tasks", icon: <TaskIcon /> },
  { href: "/estimate", label: "nav.estimate", icon: <CalculatorIcon /> },
  { href: "/demo", label: "nav.demo", icon: <ReportIcon /> },
  { href: "/insights", label: "nav.insights", icon: <ChartIcon /> },
  { href: "/retro", label: "nav.retro", icon: <IdeaIcon /> },
  { href: "/logtime", label: "nav.logtime", icon: <TimerIcon />, feature: "logTime" },
  { href: "/usage", label: "nav.usage", icon: <ClockIcon />, feature: "usage" },
  { href: "/settings", label: "nav.settings", icon: <SettingsIcon /> },
];

function Dot({ ok, label, detail }: { ok: boolean | null; label: string; detail: string }) {
  return (
    <Tooltip placement="bottom">
      <TooltipTrigger asChild>
        <Link href="/settings" className="inline-flex items-center gap-1.5 text-xs text-ui-subtle no-underline transition-colors hover:text-ui-primary">
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

const THEMES: { value: ThemePref; label: MessageKey; icon: ReactNode }[] = [
  { value: "system", label: "theme.system", icon: <SystemThemeIcon size={14} /> },
  { value: "light", label: "theme.light", icon: <LightThemeIcon size={14} /> },
  { value: "dark", label: "theme.dark", icon: <DarkThemeIcon size={14} /> },
];

/** Auto (OS) / Light / Dark. `compact` shows icons only (labels stay available to screen readers). */
function ThemeSwitch({ compact = false }: { compact?: boolean }) {
  const { t } = useT();
  const theme = useTheme((x) => x.theme);
  const setTheme = useTheme((x) => x.setTheme);
  return (
    <Segmented
      size="sm"
      fullWidth={!compact}
      selectedIndex={THEMES.findIndex((x) => x.value === theme)}
      onChange={(i) => setTheme(THEMES[i].value)}
      aria-label={t("theme.label")}
    >
      {THEMES.map((x) => (
        <SegmentedItem key={x.value}>
          {x.icon}
          <span className={compact ? "sr-only" : "truncate"}>{t(x.label)}</span>
        </SegmentedItem>
      ))}
    </Segmented>
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
    restoreTheme();
    restoreSprint();
  }, []);

  const s = settings.data;
  const jiraOk = s ? s.secrets["jira.token"].set && !!s.jira.email && !!s.jira.boardId : null;
  const cli = ai.data?.find((c) => c.provider === s?.ai.provider);
  const aiOk = ai.data && s ? !!cli?.found : null;
  const repoCount = s ? s.repos.filter((r) => r.enabled && r.path).length : 0;
  const nav = NAV.filter((n) => !n.feature || s?.features[n.feature] !== false).map((n) => ({ ...n, active: router.pathname.startsWith(n.href) }));

  return (
    <div className="min-h-screen flex flex-col">
      <header className="h-14 glass border-b flex items-center justify-between gap-3 px-4 sm:px-5 sticky top-0 z-20">
        <Link href="/sprint" className="flex min-w-0 items-center gap-2.5 no-underline">
          <span className="w-8 h-8 shrink-0 rounded-md bg-ui-brand bg-brand-gradient text-ui-on-solid grid place-items-center font-display font-bold text-sm shadow-sm">D</span>
          <span className="truncate font-display text-label font-semibold tracking-wide text-ui-heading-strong">INTERNAL DEV DASHBOARD</span>
        </Link>
        <div className="flex shrink-0 items-center gap-5">
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
      {/* Below sm the sidebar is hidden, so the same links render as a scrollable strip under the header. */}
      <nav className="sm:hidden sticky top-14 z-10 glass border-b overflow-x-auto" aria-label="Main">
        <ul className="flex list-none m-0 px-2 py-0">
          {nav.map((n) => (
            <li key={n.href} className="shrink-0">
              <Link
                href={n.href}
                aria-current={n.active ? "page" : undefined}
                className={`flex min-h-11 items-center gap-2 px-3 text-sm no-underline border-b-2 transition-colors focus-visible:-outline-offset-2 ${
                  n.active ? "border-ui-brand text-ui-brand font-semibold" : "border-transparent text-ui-subtle hover:text-ui-body"
                }`}
              >
                <span className="grid place-items-center [&_svg]:w-4 [&_svg]:h-4">{n.icon}</span>
                {t(n.label)}
              </Link>
            </li>
          ))}
          <li className="ml-auto flex shrink-0 items-center pl-3">
            <ThemeSwitch compact />
          </li>
        </ul>
      </nav>
      <div className="flex flex-1 min-h-0">
        <nav className="w-56 shrink-0 glass border-r hidden sm:block" aria-label="Main">
          <div className="sticky top-14 flex h-[calc(100vh-3.5rem)] flex-col">
            <ul className="list-none m-0 py-4 px-0 space-y-0.5 flex-1 overflow-y-auto">
              {nav.map((n) => (
                <li key={n.href}>
                  <Link
                    href={n.href}
                    aria-current={n.active ? "page" : undefined}
                    className={`flex items-center gap-3 mx-2 px-3 py-2 rounded-md text-sm no-underline border-l-[3px] transition-colors ${
                      n.active
                        ? "bg-ui-brand-surface text-ui-brand font-semibold border-ui-brand shadow-xs"
                        : "text-ui-body border-transparent hover:bg-ui-raised hover:text-ui-primary"
                    }`}
                  >
                    <span className="w-5 h-5 grid place-items-center [&_svg]:w-5 [&_svg]:h-5">{n.icon}</span>
                    {t(n.label)}
                  </Link>
                </li>
              ))}
            </ul>
            <div className="border-t border-ui-border px-3 py-3">
              <div className="mb-1.5 px-1 text-2xs font-semibold uppercase tracking-wider text-ui-secondary">{t("theme.label")}</div>
              <ThemeSwitch />
            </div>
          </div>
        </nav>
        <main className="flex-1 min-w-0 p-4 sm:p-6 max-w-[1400px]">{children}</main>
      </div>
    </div>
  );
}
