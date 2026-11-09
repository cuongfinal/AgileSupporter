import { CheckCircleIcon, CloseIcon, InfoIcon } from "@/components/icons";
import { useToasts } from "@/lib/toast";
import { useEffect } from "react";

const STYLE = {
  success: "border-l-ui-success text-ui-success",
  error: "border-l-ui-error text-ui-error",
  info: "border-l-ui-info text-ui-info",
  warning: "border-l-ui-warning text-ui-warning",
} as const;

/** Error toasts stay until closed so git / Jira messages can be read in full. */
export default function ToastHost() {
  const { items, dismiss } = useToasts();
  const last = items[items.length - 1];
  useEffect(() => {
    if (!last || last.kind === "error") return;
    const id = setTimeout(() => dismiss(last.id), 3500);
    return () => clearTimeout(id);
  }, [last, dismiss]);
  if (!last) return null;
  const Icon = last.kind === "success" ? CheckCircleIcon : InfoIcon;
  return (
    <div className="fixed top-16 right-3 sm:right-5 z-[80] w-[min(460px,calc(100vw-24px))]" role={last.kind === "error" ? "alert" : "status"}>
      <div className={`flex items-start gap-2.5 rounded-lg border border-l-4 glass-float px-3.5 py-3 ${STYLE[last.kind]}`}>
        <Icon size={18} className="mt-0.5 shrink-0" />
        <div className="min-w-0 flex-1 text-sm text-ui-primary">
          <div className="font-semibold">{last.title}</div>
          {last.message && <div className="mt-0.5 max-h-60 overflow-auto whitespace-pre-wrap break-words text-ui-body">{last.message}</div>}
        </div>
        <button type="button" aria-label="Close" onClick={() => dismiss(last.id)} className="shrink-0 rounded p-0.5 text-ui-subtle transition-colors hover:bg-ui-surface hover:text-ui-primary cursor-pointer">
          <CloseIcon size={16} />
        </button>
      </div>
    </div>
  );
}
