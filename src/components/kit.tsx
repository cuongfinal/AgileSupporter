/**
 * The dashboard's own UI kit (Tailwind only, no design-system package).
 * Props mirror what the pages already used, so components stay drop-in.
 */
import {
  type AnchorHTMLAttributes,
  type ButtonHTMLAttributes,
  Children,
  cloneElement,
  createContext,
  forwardRef,
  type InputHTMLAttributes,
  isValidElement,
  type ReactElement,
  type ReactNode,
  type RefObject,
  type TextareaHTMLAttributes,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { CloseIcon } from "./icons";

const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(" ");

type Size = "sm" | "md";

// ---------------------------------------------------------------- floating position

type Placement = "top" | "bottom" | "left" | "right";

/** Fixed position next to an anchor, so popovers are never clipped by scrolling / overflow containers. */
export function useFloating(anchor: RefObject<HTMLElement | null>, open: boolean, placement: Placement = "bottom", gap = 4) {
  const [style, setStyle] = useState<React.CSSProperties>({ position: "fixed", visibility: "hidden" });
  const floating = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const a = anchor.current?.getBoundingClientRect();
      const f = floating.current?.getBoundingClientRect();
      if (!a) return;
      const fw = f?.width ?? 0;
      const fh = f?.height ?? 0;
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      let top = 0;
      let left = 0;
      let p = placement;
      if (p === "bottom" && a.bottom + gap + fh > vh && a.top - gap - fh > 0) p = "top";
      if (p === "top" && a.top - gap - fh < 0) p = "bottom";
      if (p === "bottom") [top, left] = [a.bottom + gap, a.left];
      if (p === "top") [top, left] = [a.top - gap - fh, a.left];
      if (p === "left") [top, left] = [a.top + a.height / 2 - fh / 2, a.left - gap - fw];
      if (p === "right") [top, left] = [a.top + a.height / 2 - fh / 2, a.right + gap];
      left = Math.max(8, Math.min(left, vw - fw - 8));
      top = Math.max(8, Math.min(top, vh - fh - 8));
      setStyle({ position: "fixed", top, left, minWidth: placement === "bottom" || placement === "top" ? a.width : undefined });
    };
    place();
    const raf = requestAnimationFrame(place);
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
    };
  }, [anchor, open, placement, gap]);
  return { floating, style };
}

function Portal({ children }: { children: ReactNode }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []); // eslint-disable-line react-hooks/set-state-in-effect
  return mounted ? createPortal(children, document.body) : null;
}

// ---------------------------------------------------------------- spinner

/** Inline spinner (buttons, rows, selects). For a block / page loading state use <Loader> from components/ui. */
export function Spinner({ size = "md", className, decorative }: { size?: Size | "lg"; className?: string; decorative?: boolean }) {
  const px = size === "sm" ? "w-4 h-4" : size === "lg" ? "w-9 h-9" : "w-6 h-6";
  return (
    <span
      role={decorative ? undefined : "status"}
      aria-label={decorative ? undefined : "Loading"}
      aria-hidden={decorative || undefined}
      className={cx("inline-block shrink-0 rounded-full text-ui-brand spinner-ring animate-spin align-middle", px, className)}
    />
  );
}

// ---------------------------------------------------------------- button

type ButtonColor = "primary" | "neutral" | "danger" | "secondary";
type ButtonVariant = "solid" | "outline" | "ghost";

const BUTTON: Record<ButtonVariant, Record<ButtonColor, string>> = {
  solid: {
    primary: "bg-ui-brand bg-brand-gradient text-ui-on-solid shadow-sm hover:bg-none hover:bg-ui-brand-hover",
    neutral: "bg-ui-subtle text-ui-on-solid hover:bg-ui-body",
    danger: "bg-ui-error text-ui-on-solid hover:bg-ui-error-dark",
    secondary: "bg-ui-heading text-ui-on-solid hover:bg-ui-heading-strong",
  },
  outline: {
    primary: "border border-ui-brand text-ui-brand bg-ui-raised hover:bg-ui-brand-surface",
    neutral: "border border-ui-outline text-ui-body bg-ui-raised hover:bg-ui-float hover:border-ui-muted",
    danger: "border border-ui-error text-ui-error bg-ui-raised hover:bg-ui-error-surface",
    secondary: "border border-ui-heading text-ui-heading bg-ui-raised hover:bg-ui-secondary-surface",
  },
  ghost: {
    primary: "text-ui-brand hover:bg-ui-brand-surface",
    neutral: "text-ui-subtle hover:bg-ui-surface hover:text-ui-body",
    danger: "text-ui-error hover:bg-ui-error-surface",
    secondary: "text-ui-heading hover:bg-ui-secondary-surface",
  },
};

type ButtonOwn = {
  size?: Size;
  variant?: ButtonVariant;
  color?: ButtonColor;
  leftIcon?: ReactNode;
  loading?: boolean;
  fullWidth?: boolean;
};
type ButtonProps = ButtonOwn & ButtonHTMLAttributes<HTMLButtonElement> & { component?: undefined };
type LinkButtonProps = ButtonOwn & AnchorHTMLAttributes<HTMLAnchorElement> & { component: "a"; disabled?: boolean };

export function Button(props: ButtonProps | LinkButtonProps) {
  const { size = "md", variant = "solid", color = "primary", leftIcon, loading, fullWidth, className, children, ...rest } = props;
  const cls = cx(
    "inline-flex items-center justify-center gap-1.5 rounded-md font-medium whitespace-nowrap no-underline transition-colors cursor-pointer select-none",
    "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ui-focus",
    "disabled:opacity-50 disabled:cursor-not-allowed aria-disabled:opacity-50 aria-disabled:pointer-events-none",
    "[&_svg]:shrink-0",
    size === "sm" ? "h-8 px-2.5 text-label" : "h-9 px-4 text-sm",
    BUTTON[variant][color],
    fullWidth && "w-full",
    className,
  );
  const icon = loading ? <Spinner size="sm" className={variant === "solid" ? "!text-ui-on-solid" : ""} /> : leftIcon;
  if (rest.component === "a") {
    const { component: _c, disabled, ...a } = rest;
    void _c;
    return (
      <a {...a} className={cls} aria-disabled={disabled || loading || undefined}>
        {icon}
        {children}
      </a>
    );
  }
  const { component: _c, disabled, type = "button", ...b } = rest as ButtonProps;
  void _c;
  return (
    <button {...b} type={type} className={cls} disabled={disabled || loading}>
      {icon}
      {children}
    </button>
  );
}

// ---------------------------------------------------------------- tag

export type TagColor = "neutral" | "blue" | "green" | "orange" | "red" | "primary" | "secondary" | "purple";

const TAG: Record<"light" | "bold" | "outline", Record<TagColor, string>> = {
  light: {
    neutral: "bg-ui-surface text-ui-subtle",
    blue: "bg-ui-info-surface text-ui-info",
    green: "bg-ui-success-surface text-ui-success-dark",
    orange: "bg-ui-warning-surface text-ui-warning-dark",
    red: "bg-ui-error-surface text-ui-error",
    primary: "bg-ui-brand-surface text-ui-brand",
    secondary: "bg-ui-secondary-surface text-ui-heading",
    purple: "bg-ui-purple-surface text-ui-purple",
  },
  bold: {
    neutral: "bg-ui-subtle text-ui-on-solid",
    blue: "bg-ui-info text-ui-on-solid",
    green: "bg-ui-success text-ui-on-solid",
    orange: "bg-ui-warning text-ui-on-solid",
    red: "bg-ui-error text-ui-on-solid",
    primary: "bg-ui-brand text-ui-on-solid",
    secondary: "bg-ui-heading text-ui-on-solid",
    purple: "bg-ui-purple text-ui-on-solid",
  },
  outline: {
    neutral: "border border-ui-outline text-ui-subtle",
    blue: "border border-ui-info text-ui-info",
    green: "border border-ui-success text-ui-success-dark",
    orange: "border border-ui-warning text-ui-warning-dark",
    red: "border border-ui-error text-ui-error",
    primary: "border border-ui-brand text-ui-brand",
    secondary: "border border-ui-heading text-ui-heading",
    purple: "border border-ui-purple text-ui-purple",
  },
};

export function Tag({
  size = "md",
  color = "neutral",
  variant = "light",
  className,
  children,
}: {
  size?: Size;
  color?: TagColor;
  variant?: "light" | "bold" | "outline";
  className?: string;
  children: ReactNode;
}) {
  return (
    <span
      className={cx(
        "inline-flex items-center gap-1 rounded font-medium whitespace-nowrap leading-none",
        size === "sm" ? "h-5 px-1.5 text-2xs" : "h-6 px-2 text-xs",
        TAG[variant][color],
        className,
      )}
    >
      {children}
    </span>
  );
}

// ---------------------------------------------------------------- form controls

type CheckboxProps = Omit<InputHTMLAttributes<HTMLInputElement>, "size" | "type"> & {
  size?: Size;
  indeterminate?: boolean;
  children?: ReactNode;
};

export function Checkbox({ size = "md", indeterminate, children, className, ...rest }: CheckboxProps) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = !!indeterminate;
  }, [indeterminate]);
  const box = (
    <input
      ref={ref}
      type="checkbox"
      {...rest}
      className={cx(
        "shrink-0 accent-ui-brand cursor-pointer disabled:cursor-not-allowed disabled:opacity-50 m-0",
        size === "sm" ? "w-3.5 h-3.5" : "w-4 h-4",
        className,
      )}
    />
  );
  if (!children) return box;
  return (
    <label className="inline-flex items-center gap-2 text-sm cursor-pointer">
      {box}
      {children}
    </label>
  );
}

const FIELD =
  "rounded-md border border-ui-outline bg-ui-raised text-ui-primary placeholder:text-ui-muted transition-colors " +
  "hover:border-ui-muted focus:border-ui-focus focus:outline-none focus:ring-1 focus:ring-ui-focus " +
  "disabled:bg-ui-surface disabled:text-ui-disabled disabled:cursor-not-allowed";

type InputProps = Omit<InputHTMLAttributes<HTMLInputElement>, "size"> & { size?: Size; fullWidth?: boolean; leftContent?: ReactNode };

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { size = "md", fullWidth, leftContent, className, ...rest },
  ref,
) {
  const input = (
    <input
      ref={ref}
      {...rest}
      className={cx(FIELD, size === "sm" ? "h-8 px-2.5 text-label" : "h-9 px-3 text-sm", !!leftContent && "pl-8", fullWidth && "w-full", className)}
    />
  );
  if (!leftContent) return input;
  return (
    <span className={cx("relative inline-flex items-center", fullWidth && "w-full")}>
      <span className="absolute left-2.5 text-ui-muted pointer-events-none flex">{leftContent}</span>
      {input}
    </span>
  );
});

export function Textarea({
  size = "md",
  fullWidth,
  minRows = 3,
  className,
  ...rest
}: Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "rows"> & { size?: Size; fullWidth?: boolean; minRows?: number }) {
  return (
    <textarea
      rows={minRows}
      {...rest}
      className={cx(FIELD, "block resize-y py-2 leading-relaxed", size === "sm" ? "px-2.5 text-label" : "px-3 text-sm", fullWidth && "w-full", className)}
    />
  );
}

export function Toggle({
  size = "md",
  className,
  ...rest
}: Omit<InputHTMLAttributes<HTMLInputElement>, "size" | "type"> & { size?: Size }) {
  const sm = size === "sm";
  return (
    <label className={cx("relative inline-flex shrink-0 items-center cursor-pointer", rest.disabled && "opacity-50 cursor-not-allowed", className)}>
      <input type="checkbox" role="switch" {...rest} className="peer sr-only" />
      <span
        className={cx(
          "rounded-full bg-ui-outline transition-colors peer-checked:bg-ui-brand peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-ui-focus",
          sm ? "w-8 h-[18px]" : "w-10 h-[22px]",
        )}
      />
      <span
        className={cx(
          "absolute rounded-full bg-ui-raised shadow transition-transform",
          sm ? "left-[3px] w-3 h-3 peer-checked:translate-x-[14px]" : "left-[3px] w-4 h-4 peer-checked:translate-x-[18px]",
        )}
      />
    </label>
  );
}

// ---------------------------------------------------------------- segmented

export function SegmentedItem({ children }: { children: ReactNode }) {
  return <>{children}</>;
}

export function Segmented({
  selectedIndex,
  onChange,
  size = "md",
  fullWidth,
  children,
  ...aria
}: {
  selectedIndex: number;
  onChange: (i: number) => void;
  size?: Size;
  /** Stretch to the container; items share the width equally. */
  fullWidth?: boolean;
  children: ReactNode;
  "aria-label"?: string;
}) {
  const items = Children.toArray(children).filter(isValidElement);
  return (
    <div role="radiogroup" aria-label={aria["aria-label"]} className={cx("rounded-md border border-ui-border bg-ui-surface p-0.5 gap-0.5", fullWidth ? "flex w-full" : "inline-flex")}>
      {items.map((item, i) => (
        <button
          key={i}
          type="button"
          role="radio"
          aria-checked={i === selectedIndex}
          onClick={() => i !== selectedIndex && onChange(i)}
          className={cx(
            "inline-flex items-center justify-center rounded font-medium whitespace-nowrap transition-colors cursor-pointer [&_svg]:shrink-0",
            // fullWidth: equal tiles, icon stacked over the label so short widths never truncate
            fullWidth ? "flex-1 min-w-0 flex-col gap-0.5 px-1 py-1.5 text-xs" : cx("gap-1.5", size === "sm" ? "h-7 px-2.5 text-xs" : "h-8 px-3 text-sm"),
            i === selectedIndex ? "bg-ui-float text-ui-brand font-semibold shadow-sm" : "text-ui-subtle hover:bg-ui-raised hover:text-ui-body",
          )}
        >
          {(item as ReactElement<{ children: ReactNode }>).props.children}
        </button>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------- tabs

const TabsCtx = createContext<{ selected: number; onChange: (i: number) => void }>({ selected: 0, onChange: () => undefined });

export function Tabs({
  selectedIndex,
  onChange,
  className,
  children,
}: {
  selectedIndex: number;
  onChange: (i: number) => void;
  className?: string;
  children: ReactNode;
}) {
  return (
    <TabsCtx.Provider value={{ selected: selectedIndex, onChange }}>
      <div className={className}>{children}</div>
    </TabsCtx.Provider>
  );
}

export function TabHeader({ children }: { children: ReactNode }) {
  return <div className="border-b border-ui-border">{children}</div>;
}

export function TabList({ children }: { children: ReactNode }) {
  const items = Children.toArray(children).filter(isValidElement) as ReactElement<{ index?: number }>[];
  return (
    <div role="tablist" className="flex flex-wrap gap-1 -mb-px overflow-x-auto">
      {items.map((item, i) => cloneElement(item, { index: i, key: item.key ?? i }))}
    </div>
  );
}

export function TabListItem({ index = 0, children }: { index?: number; children: ReactNode }) {
  const { selected, onChange } = useContext(TabsCtx);
  const on = index === selected;
  return (
    <button
      type="button"
      role="tab"
      aria-selected={on}
      onClick={() => onChange(index)}
      className={cx(
        "px-3 py-2 text-sm whitespace-nowrap border-b-2 transition-colors cursor-pointer focus-visible:-outline-offset-2",
        on ? "border-ui-brand text-ui-brand font-semibold" : "border-transparent text-ui-subtle hover:text-ui-body hover:border-ui-border",
      )}
    >
      {children}
    </button>
  );
}

// ---------------------------------------------------------------- drawer

const DrawerCtx = createContext<() => void>(() => undefined);

export function Drawer({
  open,
  onOpenChange,
  className,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  placement?: "right";
  className?: string;
  children: ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onOpenChange(false);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onOpenChange]);
  if (!open) return null;
  return (
    <Portal>
      <DrawerCtx.Provider value={() => onOpenChange(false)}>
        <div className="fixed inset-0 z-40 bg-ui-overlay backdrop-blur-[2px]" onClick={() => onOpenChange(false)} aria-hidden />
        <aside role="dialog" aria-modal className={cx("fixed right-0 top-0 z-50 h-full w-[560px] max-w-full glass-float border-l flex flex-col", className)}>
          {children}
        </aside>
      </DrawerCtx.Provider>
    </Portal>
  );
}

export function DrawerHeader({ children }: { children: ReactNode }) {
  const close = useContext(DrawerCtx);
  return (
    <header className="flex items-start justify-between gap-3 px-5 py-4 border-b border-ui-border">
      <div className="min-w-0 flex-1">{children}</div>
      <button
        type="button"
        onClick={close}
        aria-label="Close"
        className="shrink-0 rounded-md p-1.5 text-ui-subtle transition-colors hover:bg-ui-surface hover:text-ui-primary cursor-pointer"
      >
        <CloseIcon size={18} />
      </button>
    </header>
  );
}

export function DrawerBody({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cx("flex-1 min-h-0 overflow-auto px-5 py-4", className)}>{children}</div>;
}

// ---------------------------------------------------------------- tooltip

const TipCtx = createContext<{ anchor: RefObject<HTMLSpanElement>; open: boolean; set: (o: boolean) => void; placement: Placement }>({
  anchor: { current: null },
  open: false,
  set: () => undefined,
  placement: "top",
});

export function Tooltip({ placement = "top", children }: { placement?: Placement; children: ReactNode }) {
  const anchor = useRef<HTMLSpanElement>(null);
  const [open, set] = useState(false);
  return <TipCtx.Provider value={{ anchor, open, set, placement }}>{children}</TipCtx.Provider>;
}

export function TooltipTrigger({ children }: { asChild?: boolean; children: ReactNode }) {
  const { anchor, set } = useContext(TipCtx);
  return (
    <span
      ref={anchor}
      className="inline-flex"
      onMouseEnter={() => set(true)}
      onMouseLeave={() => set(false)}
      onFocus={() => set(true)}
      onBlur={() => set(false)}
    >
      {children}
    </span>
  );
}

export function TooltipContent({ children }: { children: ReactNode }) {
  const { anchor, open, placement } = useContext(TipCtx);
  const { floating, style } = useFloating(anchor, open, placement, 6);
  if (!open) return null;
  return (
    <Portal>
      <div
        ref={floating}
        role="tooltip"
        style={{ ...style, minWidth: undefined }}
        className="z-[70] max-w-[360px] rounded-md bg-ui-primary px-2.5 py-1.5 text-xs text-ui-on-solid shadow-lg pointer-events-none"
      >
        {children}
      </div>
    </Portal>
  );
}
