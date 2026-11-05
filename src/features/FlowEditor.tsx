import { Button, Checkbox, Input, Textarea } from "@/components/kit";
import { AddIcon, ArrowDownIcon, ArrowUpIcon, TrashIcon } from "@/components/icons";
import { Select } from "@/components/Select";
import { type MessageKey, useT } from "@/lib/i18n";
import type { DemoFlow, FlowAction, FlowActionType, FlowStep, FlowTarget, FlowTargetBy } from "@/lib/types";

/** What each action needs; drives which inputs the editor shows. */
const ACTIONS: Record<FlowActionType, { target: "required" | "optional" | "none"; value: "required" | "optional" | "none" }> = {
  goto: { target: "none", value: "required" },
  click: { target: "required", value: "none" },
  dblclick: { target: "required", value: "none" },
  hover: { target: "required", value: "none" },
  fill: { target: "required", value: "required" },
  select: { target: "required", value: "required" },
  press: { target: "optional", value: "required" },
  waitFor: { target: "optional", value: "optional" },
  scroll: { target: "optional", value: "optional" },
  wait: { target: "none", value: "required" },
  resize: { target: "none", value: "required" },
};
const ACTION_ORDER: FlowActionType[] = ["goto", "click", "dblclick", "fill", "select", "press", "hover", "waitFor", "scroll", "wait", "resize"];
const BY_ORDER: FlowTargetBy[] = ["role", "label", "text", "placeholder", "testId", "css"];
const ROLES = ["button", "link", "textbox", "tab", "checkbox", "switch", "combobox", "option", "menuitem", "row", "cell", "heading", "dialog", "radio"];
const SIZES = ["1280x800", "1440x900", "1536x864", "1920x1080"];
const KEYS = ["Enter", "Escape", "Tab", "ArrowDown", "ArrowUp", "Space", "Backspace"];

const emptyTarget = (): FlowTarget => ({ by: "role", value: "button", name: "", nth: 0 });
const emptyAction = (): FlowAction => ({ type: "click", target: emptyTarget(), value: "" });
const emptyStep = (): FlowStep => ({ narration: "", actions: [emptyAction()], screenshot: false });

function move<T>(arr: T[], i: number, dir: -1 | 1): T[] {
  const j = i + dir;
  if (j < 0 || j >= arr.length) return arr;
  const out = [...arr];
  [out[i], out[j]] = [out[j], out[i]];
  return out;
}

function IconBtn({ label, onClick, disabled, danger, children }: { label: string; onClick: () => void; disabled?: boolean; danger?: boolean; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className={`w-7 h-7 grid place-items-center rounded border-0 bg-transparent cursor-pointer disabled:opacity-30 disabled:cursor-default [&_svg]:w-4 [&_svg]:h-4 ${
        danger ? "text-ui-error hover:bg-ui-error-surface" : "text-ui-subtle hover:bg-ui-surface"
      }`}
    >
      {children}
    </button>
  );
}

function ActionRow({
  a,
  onChange,
  onRemove,
  onMove,
  first,
  last,
}: {
  a: FlowAction;
  onChange: (a: FlowAction) => void;
  onRemove: () => void;
  onMove: (dir: -1 | 1) => void;
  first: boolean;
  last: boolean;
}) {
  const { t } = useT();
  const spec = ACTIONS[a.type];
  const setType = (type: FlowActionType) => {
    const next = ACTIONS[type];
    onChange({
      type,
      target: next.target === "none" ? null : (a.target ?? (next.target === "required" ? emptyTarget() : null)),
      value: next.value === "none" ? "" : type === "resize" && !/^\d+x\d+$/.test(a.value) ? "1920x1080" : a.value,
    });
  };
  const tgt = a.target;
  const setTarget = (patch: Partial<FlowTarget>) => onChange({ ...a, target: { ...(tgt ?? emptyTarget()), ...patch } });
  const valueLabel = t(`flow.value.${a.type}` as MessageKey);
  return (
    <div className="rounded-md border border-ui-border bg-white p-2 space-y-2">
      <div className="flex flex-wrap items-end gap-2">
        <div className="w-44">
          <span className="block text-[11px] text-ui-secondary mb-0.5">{t("flow.action")}</span>
          <Select
            size="sm"
            items={ACTION_ORDER.map((k) => ({ value: k, label: t(`flow.type.${k}` as MessageKey), helperText: t(`flow.typeHint.${k}` as MessageKey) }))}
            value={[a.type]}
            onValueChange={(v) => v[0] && setType(v[0] as FlowActionType)}
          />
        </div>
        {spec.value !== "none" && (
          <div className="flex-1 min-w-[180px]">
            <span className="block text-[11px] text-ui-secondary mb-0.5">
              {valueLabel}
              {spec.value === "optional" && ` (${t("flow.optional")})`}
            </span>
            {a.type === "resize" ? (
              <Select size="sm" items={SIZES.map((s) => ({ value: s, label: s.replace("x", " × ") }))} value={[a.value]} onValueChange={(v) => v[0] && onChange({ ...a, value: v[0] })} />
            ) : a.type === "press" ? (
              <Select size="sm" items={KEYS.map((k) => ({ value: k, label: k }))} value={[a.value]} onValueChange={(v) => v[0] && onChange({ ...a, value: v[0] })} />
            ) : (
              <Input
                size="sm"
                fullWidth
                inputMode={a.type === "wait" || a.type === "waitFor" || a.type === "scroll" ? "numeric" : undefined}
                placeholder={t(`flow.valueHint.${a.type}` as MessageKey)}
                value={a.value}
                onChange={(e) => onChange({ ...a, value: e.target.value })}
              />
            )}
          </div>
        )}
        <span className="flex ml-auto">
          <IconBtn label={t("flow.up")} disabled={first} onClick={() => onMove(-1)}>
            <ArrowUpIcon />
          </IconBtn>
          <IconBtn label={t("flow.down")} disabled={last} onClick={() => onMove(1)}>
            <ArrowDownIcon />
          </IconBtn>
          <IconBtn label={t("flow.removeAction")} danger onClick={onRemove}>
            <TrashIcon />
          </IconBtn>
        </span>
      </div>
      {spec.target !== "none" && (
        <div className="flex flex-wrap items-end gap-2 pl-2 border-l-2 border-ui-brand-soft">
          {spec.target === "optional" && (
            <label className="flex items-center gap-1.5 text-xs pb-1.5">
              <Checkbox size="sm" checked={!!tgt} onChange={(e) => onChange({ ...a, target: e.target.checked ? emptyTarget() : null })} />
              {t("flow.onElement")}
            </label>
          )}
          {tgt && (
            <>
              <div className="w-36">
                <span className="block text-[11px] text-ui-secondary mb-0.5">{t("flow.findBy")}</span>
                <Select
                  size="sm"
                  items={BY_ORDER.map((b) => ({ value: b, label: t(`flow.by.${b}` as MessageKey) }))}
                  value={[tgt.by]}
                  onValueChange={(v) => v[0] && setTarget({ by: v[0] as FlowTargetBy, value: v[0] === "role" ? "button" : "", name: "" })}
                />
              </div>
              {tgt.by === "role" ? (
                <>
                  <div className="w-36">
                    <span className="block text-[11px] text-ui-secondary mb-0.5">{t("flow.role")}</span>
                    <Select
                      size="sm"
                      items={[...new Set([...ROLES, tgt.value])].filter(Boolean).map((r) => ({ value: r, label: r }))}
                      value={[tgt.value]}
                      onValueChange={(v) => v[0] && setTarget({ value: v[0] })}
                    />
                  </div>
                  <div className="flex-1 min-w-[160px]">
                    <span className="block text-[11px] text-ui-secondary mb-0.5">{t("flow.name")}</span>
                    <Input size="sm" fullWidth placeholder={t("flow.nameHint")} value={tgt.name} onChange={(e) => setTarget({ name: e.target.value })} />
                  </div>
                </>
              ) : (
                <div className="flex-1 min-w-[200px]">
                  <span className="block text-[11px] text-ui-secondary mb-0.5">{t(`flow.byValue.${tgt.by}` as MessageKey)}</span>
                  <Input size="sm" fullWidth className={tgt.by === "css" ? "font-mono" : ""} value={tgt.value} onChange={(e) => setTarget({ value: e.target.value })} />
                </div>
              )}
              <div className="w-20" title={t("flow.nthHint")}>
                <span className="block text-[11px] text-ui-secondary mb-0.5">{t("flow.nth")}</span>
                <Input
                  size="sm"
                  fullWidth
                  inputMode="numeric"
                  value={String(tgt.nth + 1)}
                  onChange={(e) => setTarget({ nth: Math.max(0, (Number(e.target.value.replace(/\D/g, "")) || 1) - 1) })}
                />
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function StepEditor({
  st,
  index,
  onChange,
  onRemove,
  onMove,
  first,
  last,
}: {
  st: FlowStep;
  index: number;
  onChange: (s: FlowStep) => void;
  onRemove: () => void;
  onMove: (dir: -1 | 1) => void;
  first: boolean;
  last: boolean;
}) {
  const { t } = useT();
  const setAction = (i: number, a: FlowAction) => onChange({ ...st, actions: st.actions.map((x, j) => (j === i ? a : x)) });
  return (
    <li className="rounded-md bg-ui-surface p-2.5 space-y-2">
      <div className="flex items-center gap-2">
        <span className="text-xs font-semibold text-ui-heading">
          {t("rec.step")} {index + 1}
        </span>
        <label className="flex items-center gap-1.5 text-xs ml-2">
          <Checkbox size="sm" checked={st.screenshot} onChange={(e) => onChange({ ...st, screenshot: e.target.checked })} />
          📷 {t("flow.screenshot")}
        </label>
        <span className="flex ml-auto">
          <IconBtn label={t("flow.up")} disabled={first} onClick={() => onMove(-1)}>
            <ArrowUpIcon />
          </IconBtn>
          <IconBtn label={t("flow.down")} disabled={last} onClick={() => onMove(1)}>
            <ArrowDownIcon />
          </IconBtn>
          <IconBtn label={t("flow.removeStep")} danger onClick={onRemove}>
            <TrashIcon />
          </IconBtn>
        </span>
      </div>
      <div>
        <span className="block text-[11px] text-ui-secondary mb-0.5">{t("flow.narration")}</span>
        <Textarea size="sm" fullWidth minRows={2} value={st.narration} onChange={(e) => onChange({ ...st, narration: e.target.value })} />
      </div>
      <div className="space-y-1.5">
        {st.actions.map((a, i) => (
          <ActionRow
            key={i}
            a={a}
            first={i === 0}
            last={i === st.actions.length - 1}
            onChange={(na) => setAction(i, na)}
            onRemove={() => onChange({ ...st, actions: st.actions.filter((_, j) => j !== i) })}
            onMove={(dir) => onChange({ ...st, actions: move(st.actions, i, dir) })}
          />
        ))}
        <Button size="sm" variant="ghost" leftIcon={<AddIcon />} onClick={() => onChange({ ...st, actions: [...st.actions, emptyAction()] })}>
          {t("flow.addAction")}
        </Button>
      </div>
    </li>
  );
}

/** Form editor for a demo flow: pickers for action types and targets, so nobody has to know the JSON shape. */
export default function FlowEditor({ flow, onChange }: { flow: DemoFlow; onChange: (f: DemoFlow) => void }) {
  const { t } = useT();
  const setScenario = (i: number, patch: Partial<DemoFlow["scenarios"][number]>) =>
    onChange({ ...flow, scenarios: flow.scenarios.map((s, j) => (j === i ? { ...s, ...patch } : s)) });
  return (
    <div className="space-y-4">
      {flow.scenarios.map((sc, si) => (
        <section key={si} className="border border-ui-border rounded-md">
          <header className="flex items-center gap-2 px-3 py-2 bg-white border-b border-ui-border rounded-t-md">
            <span className="text-sm font-semibold text-ui-heading">{si + 1}.</span>
            <Input size="sm" fullWidth value={sc.name} onChange={(e) => setScenario(si, { name: e.target.value })} aria-label={t("flow.scenarioName")} />
            <span className="flex">
              <IconBtn label={t("flow.up")} disabled={si === 0} onClick={() => onChange({ ...flow, scenarios: move(flow.scenarios, si, -1) })}>
                <ArrowUpIcon />
              </IconBtn>
              <IconBtn label={t("flow.down")} disabled={si === flow.scenarios.length - 1} onClick={() => onChange({ ...flow, scenarios: move(flow.scenarios, si, 1) })}>
                <ArrowDownIcon />
              </IconBtn>
              <IconBtn label={t("flow.removeScenario")} danger onClick={() => onChange({ ...flow, scenarios: flow.scenarios.filter((_, j) => j !== si) })}>
                <TrashIcon />
              </IconBtn>
            </span>
          </header>
          <ol className="list-none m-0 p-2.5 space-y-2">
            {sc.steps.map((st, ti) => (
              <StepEditor
                key={ti}
                st={st}
                index={ti}
                first={ti === 0}
                last={ti === sc.steps.length - 1}
                onChange={(ns) => setScenario(si, { steps: sc.steps.map((x, j) => (j === ti ? ns : x)) })}
                onRemove={() => setScenario(si, { steps: sc.steps.filter((_, j) => j !== ti) })}
                onMove={(dir) => setScenario(si, { steps: move(sc.steps, ti, dir) })}
              />
            ))}
            <li>
              <Button size="sm" variant="outline" leftIcon={<AddIcon />} onClick={() => setScenario(si, { steps: [...sc.steps, emptyStep()] })}>
                {t("flow.addStep")}
              </Button>
            </li>
          </ol>
        </section>
      ))}
      <Button
        size="sm"
        variant="outline"
        leftIcon={<AddIcon />}
        onClick={() =>
          onChange({
            ...flow,
            scenarios: [...flow.scenarios, { name: t("flow.newScenario"), steps: [{ ...emptyStep(), actions: [{ type: "goto", target: null, value: "" }] }] }],
          })
        }
      >
        {t("flow.addScenario")}
      </Button>
    </div>
  );
}
