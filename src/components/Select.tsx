import { type KeyboardEvent, useEffect, useId, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { CheckIcon, ChevronDownIcon, CloseIcon, SearchIcon } from "./icons";
import { Spinner, useFloating } from "./kit";

export type SelectItem = { label: string; value: string; helperText?: string; disabled?: boolean };

const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(" ");

/** Single or multi select with a searchable list (shown when there are many options). Value is always an array. */
export function Select({
  items,
  value = [],
  onValueChange,
  multiple,
  clearable,
  limitTags = 2,
  placeholder,
  size = "md",
  disabled,
  loading,
  className,
  "aria-label": ariaLabel,
}: {
  items: SelectItem[];
  value?: string[];
  onValueChange?: (value: string[]) => void;
  multiple?: boolean;
  clearable?: boolean;
  limitTags?: number;
  placeholder?: string;
  size?: "sm" | "md";
  disabled?: boolean;
  loading?: boolean;
  fullWidth?: boolean;
  className?: string;
  "aria-label"?: string;
}) {
  const trigger = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const { floating, style } = useFloating(trigger, open, "bottom", 4);
  const searchable = items.length > 8;
  const listId = useId();

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? items.filter((i) => i.label.toLowerCase().includes(q) || i.value.toLowerCase().includes(q)) : items;
  }, [items, query]);
  const selected = items.filter((i) => value.includes(i.value));

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!trigger.current?.contains(t) && !floating.current?.contains(t)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open, floating]);

  const show = () => {
    if (disabled) return;
    setQuery("");
    setActive(Math.max(0, items.findIndex((i) => value.includes(i.value))));
    setOpen(true);
  };
  const close = () => {
    setOpen(false);
    trigger.current?.focus();
  };
  const choose = (item: SelectItem) => {
    if (item.disabled) return;
    if (!multiple) {
      onValueChange?.([item.value]);
      close();
      return;
    }
    onValueChange?.(value.includes(item.value) ? value.filter((v) => v !== item.value) : [...value, item.value]);
  };
  const onKey = (e: KeyboardEvent) => {
    if (!open) {
      if (["ArrowDown", "Enter", " "].includes(e.key)) {
        e.preventDefault();
        show();
      }
      return;
    }
    if (e.key === "Escape") {
      e.preventDefault();
      close();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => Math.min(shown.length - 1, a + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(0, a - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (shown[active]) choose(shown[active]);
    }
  };

  const sm = size === "sm";
  const label = multiple ? (
    selected.length ? (
      <span className="flex min-w-0 items-center gap-1 overflow-hidden">
        {selected.slice(0, limitTags).map((s) => (
          <span key={s.value} className="truncate rounded bg-ui-brand-surface px-1.5 py-0.5 text-2xs font-medium text-ui-brand max-w-[140px]">
            {s.label}
          </span>
        ))}
        {selected.length > limitTags && <span className="text-2xs text-ui-secondary">+{selected.length - limitTags}</span>}
      </span>
    ) : null
  ) : selected[0] ? (
    <span className="truncate">{selected[0].label}</span>
  ) : null;

  return (
    <>
      <button
        ref={trigger}
        type="button"
        role="combobox"
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-controls={listId}
        aria-label={ariaLabel}
        disabled={disabled}
        onClick={() => (open ? setOpen(false) : show())}
        onKeyDown={onKey}
        className={cx(
          "group flex w-full items-center gap-1.5 rounded-md border bg-ui-raised text-left transition-colors cursor-pointer",
          "focus:outline-none focus-visible:border-ui-focus focus-visible:ring-1 focus-visible:ring-ui-focus",
          open ? "border-ui-brand" : "border-ui-outline hover:border-ui-muted",
          "disabled:bg-ui-surface disabled:text-ui-disabled disabled:cursor-not-allowed",
          sm ? "h-8 px-2.5 text-label" : "h-9 px-3 text-sm",
          className,
        )}
      >
        <span className="min-w-0 flex-1 truncate">{label ?? <span className="text-ui-muted">{placeholder ?? ""}</span>}</span>
        {loading && <Spinner size="sm" />}
        {clearable && value.length > 0 && !disabled && (
          <span
            role="button"
            tabIndex={-1}
            aria-label="Clear"
            onClick={(e) => {
              e.stopPropagation();
              onValueChange?.([]);
            }}
            className="rounded p-0.5 text-ui-muted hover:bg-ui-surface hover:text-ui-body"
          >
            <CloseIcon size={14} />
          </span>
        )}
        <ChevronDownIcon size={16} className={cx("shrink-0 text-ui-secondary transition-transform", open && "rotate-180")} />
      </button>
      {open &&
        createPortal(
          <div
            ref={floating}
            style={style}
            className="z-[60] max-w-[min(480px,calc(100vw-16px))] overflow-hidden rounded-md border glass-float"
            onKeyDown={onKey}
          >
            {searchable && (
              <div className="flex items-center gap-2 border-b border-ui-border px-2.5">
                <SearchIcon size={14} className="text-ui-muted" />
                <input
                  autoFocus
                  value={query}
                  onChange={(e) => {
                    setQuery(e.target.value);
                    setActive(0);
                  }}
                  placeholder="Search…"
                  className="h-8 w-full border-0 bg-transparent text-label outline-none"
                />
              </div>
            )}
            <ul id={listId} role="listbox" aria-multiselectable={multiple || undefined} className="m-0 max-h-72 list-none overflow-auto p-1">
              {shown.map((item, i) => {
                const on = value.includes(item.value);
                return (
                  <li
                    key={item.value}
                    role="option"
                    aria-selected={on}
                    aria-disabled={item.disabled || undefined}
                    onMouseEnter={() => setActive(i)}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => choose(item)}
                    className={cx(
                      "flex items-start gap-2 rounded px-2 py-1.5 text-label",
                      item.disabled ? "cursor-not-allowed text-ui-disabled" : "cursor-pointer",
                      i === active && !item.disabled && "bg-ui-surface",
                      on && "text-ui-brand font-medium",
                    )}
                  >
                    {multiple ? (
                      <span
                        className={cx(
                          "mt-0.5 grid h-3.5 w-3.5 shrink-0 place-items-center rounded-[3px] border",
                          on ? "border-ui-brand bg-ui-brand text-ui-on-solid" : "border-ui-outline bg-ui-raised",
                        )}
                      >
                        {on && <CheckIcon size={10} strokeWidth={3} />}
                      </span>
                    ) : (
                      <span className="mt-0.5 w-3.5 shrink-0">{on && <CheckIcon size={14} />}</span>
                    )}
                    <span className="min-w-0">
                      <span className="block">{item.label}</span>
                      {item.helperText && <span className="block text-2xs font-normal text-ui-secondary">{item.helperText}</span>}
                    </span>
                  </li>
                );
              })}
              {!shown.length && <li className="px-2 py-2 text-xs text-ui-secondary">—</li>}
            </ul>
          </div>,
          document.body,
        )}
    </>
  );
}
