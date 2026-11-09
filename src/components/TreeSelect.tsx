import { type KeyboardEvent, type ReactNode, useEffect, useId, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { CheckIcon, ChevronDownIcon, ChevronRightIcon, SearchIcon } from "./icons";
import { Spinner, useFloating } from "./kit";

/** A branch has children and only expands; a leaf (no children) is what gets picked. */
export type TreeNode = { id: string; label: string; hint?: string; children?: TreeNode[] };

const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(" ");

type Leaf = { node: TreeNode; path: string[] };

function leaves(nodes: TreeNode[], path: string[] = []): Leaf[] {
  return nodes.flatMap((n) => (n.children ? leaves(n.children, [...path, n.label]) : [{ node: n, path }]));
}

/** Ids of the branches that lead to `id`, so the tree opens on the current pick. */
function ancestors(nodes: TreeNode[], id: string, trail: string[] = []): string[] | null {
  for (const n of nodes) {
    if (n.id === id && !n.children) return trail;
    if (n.children) {
      const hit = ancestors(n.children, id, [...trail, n.id]);
      if (hit) return hit;
    }
  }
  return null;
}

/**
 * Single select over a tree (e.g. project → work item → task). Branches open and close on click; only leaves can be
 * picked. Typing in the search box switches to a flat list of matching leaves with their path. Optional `recent`
 * leaf ids are listed above the tree for one-click reuse.
 */
export function TreeSelect({
  nodes,
  value,
  onChange,
  recent = [],
  recentLabel = "Recent",
  placeholder,
  searchPlaceholder = "Search…",
  emptyText = "—",
  disabled,
  loading,
  className,
  "aria-label": ariaLabel,
}: {
  nodes: TreeNode[];
  value: string;
  onChange: (id: string) => void;
  recent?: string[];
  recentLabel?: string;
  placeholder?: ReactNode;
  searchPlaceholder?: string;
  emptyText?: string;
  disabled?: boolean;
  loading?: boolean;
  className?: string;
  "aria-label"?: string;
}) {
  const trigger = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const { floating, style } = useFloating(trigger, open, "bottom", 4);
  const treeId = useId();

  const all = useMemo(() => leaves(nodes), [nodes]);
  const byId = useMemo(() => new Map(all.map((l) => [l.node.id, l])), [all]);
  const current = byId.get(value);
  const recentLeaves = recent.map((id) => byId.get(id)).filter((l): l is Leaf => !!l);
  const q = query.trim().toLowerCase();
  const matches = q ? all.filter((l) => [l.node.label, l.node.id, ...l.path].some((x) => x.toLowerCase().includes(q))) : [];

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
    // Open on the current pick; with nothing picked yet, a single top-level branch opens by itself.
    const trail = value ? ancestors(nodes, value) : null;
    setExpanded(new Set(trail ?? (nodes.length === 1 ? [nodes[0].id] : [])));
    setOpen(true);
  };
  const close = () => {
    setOpen(false);
    trigger.current?.focus();
  };
  const pick = (id: string) => {
    onChange(id);
    close();
  };
  const toggle = (id: string) =>
    setExpanded((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  // Arrow keys walk the visible rows; Left/Right close/open a branch, like a file tree.
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      close();
      return;
    }
    const rows = [...(floating.current?.querySelectorAll<HTMLElement>("[data-row]") ?? [])];
    const at = rows.indexOf(document.activeElement as HTMLElement);
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const next = e.key === "ArrowDown" ? Math.min(rows.length - 1, at + 1) : Math.max(0, at - 1);
      rows[at < 0 ? 0 : next]?.focus();
    } else if ((e.key === "ArrowRight" || e.key === "ArrowLeft") && at >= 0) {
      const id = rows[at].dataset.branch;
      if (!id) return;
      e.preventDefault();
      if ((e.key === "ArrowRight") !== expanded.has(id)) toggle(id);
    }
  };

  const leafRow = (l: Leaf, level: number, showPath: boolean) => {
    const on = l.node.id === value;
    return (
      <li key={`${showPath ? "flat" : "tree"}-${l.node.id}`} role="treeitem" aria-level={level} aria-selected={on}>
        <button
          type="button"
          data-row
          onClick={() => pick(l.node.id)}
          className={cx(
            "flex w-full items-start gap-1.5 rounded border-0 bg-transparent py-1.5 pr-2 text-left text-label cursor-pointer",
            "hover:bg-ui-surface focus-visible:bg-ui-surface focus-visible:outline-none",
            on ? "font-medium text-ui-brand" : "text-ui-body",
          )}
          style={{ paddingLeft: showPath ? 8 : 8 + (level - 1) * 16 }}
        >
          <span className="mt-0.5 w-3.5 shrink-0">{on && <CheckIcon size={14} />}</span>
          <span className="min-w-0">
            <span className="block">{l.node.label}</span>
            {(showPath || l.node.hint) && (
              <span className="block text-2xs font-normal text-ui-secondary">
                {[showPath && l.path.join(" › "), l.node.hint].filter(Boolean).join(" · ")}
              </span>
            )}
          </span>
        </button>
      </li>
    );
  };

  const branch = (n: TreeNode, level: number, path: string[]): ReactNode => {
    if (!n.children) return leafRow({ node: n, path }, level, false);
    const isOpen = expanded.has(n.id);
    const holdsPick = !!value && !isOpen && !!ancestors(n.children, value);
    return (
      <li key={n.id} role="treeitem" aria-level={level} aria-expanded={isOpen} aria-selected={false}>
        <button
          type="button"
          data-row
          data-branch={n.id}
          onClick={() => toggle(n.id)}
          className={cx(
            "flex w-full items-center gap-1.5 rounded border-0 bg-transparent py-1.5 pr-2 text-left text-label cursor-pointer",
            "hover:bg-ui-surface focus-visible:bg-ui-surface focus-visible:outline-none",
            level === 1 ? "font-semibold text-ui-heading" : "font-medium text-ui-body",
          )}
          style={{ paddingLeft: 8 + (level - 1) * 16 }}
        >
          <ChevronRightIcon size={14} className={cx("shrink-0 text-ui-muted transition-transform", isOpen && "rotate-90")} />
          <span className="min-w-0 flex-1 truncate" title={n.label}>
            {n.label}
          </span>
          {holdsPick && <span aria-hidden className="h-1.5 w-1.5 shrink-0 rounded-full bg-ui-brand" />}
          <span className="shrink-0 text-2xs font-normal text-ui-muted">{leaves(n.children).length}</span>
        </button>
        {isOpen && (
          <ul role="group" className="m-0 list-none p-0">
            {n.children.map((c) => branch(c, level + 1, [...path, n.label]))}
          </ul>
        )}
      </li>
    );
  };

  const sectionTitle = "px-2 pb-1 pt-2 text-2xs font-semibold uppercase tracking-wider text-ui-secondary";

  return (
    <>
      <button
        ref={trigger}
        type="button"
        role="combobox"
        aria-expanded={open}
        aria-haspopup="tree"
        aria-controls={treeId}
        aria-label={ariaLabel}
        disabled={disabled}
        title={current ? [...current.path, current.node.label].join(" › ") : undefined}
        onClick={() => (open ? setOpen(false) : show())}
        onKeyDown={(e) => {
          if (!open && ["ArrowDown", "Enter", " "].includes(e.key)) {
            e.preventDefault();
            show();
          } else if (open && e.key === "Escape") {
            e.preventDefault();
            close();
          }
        }}
        className={cx(
          "group flex h-8 w-full items-center gap-1.5 rounded-md border bg-ui-raised px-2.5 text-left text-label transition-colors cursor-pointer",
          "focus:outline-none focus-visible:border-ui-focus focus-visible:ring-1 focus-visible:ring-ui-focus",
          open ? "border-ui-brand" : "border-ui-outline hover:border-ui-muted",
          "disabled:bg-ui-surface disabled:text-ui-disabled disabled:cursor-not-allowed",
          className,
        )}
      >
        <span className="min-w-0 flex-1 truncate">
          {current ? current.node.label : <span className="text-ui-muted">{placeholder ?? ""}</span>}
        </span>
        {loading && <Spinner size="sm" />}
        <ChevronDownIcon size={16} className={cx("shrink-0 text-ui-secondary transition-transform", open && "rotate-180")} />
      </button>
      {open &&
        createPortal(
          <div
            ref={floating}
            style={style}
            className="z-[60] flex max-h-[min(420px,calc(100vh-16px))] w-[min(520px,calc(100vw-16px))] flex-col overflow-hidden rounded-md border glass-float"
            onKeyDown={onKey}
          >
            <div className="flex shrink-0 items-center gap-2 border-b border-ui-border px-2.5">
              <SearchIcon size={14} className="text-ui-muted" />
              <input
                autoFocus
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={searchPlaceholder}
                aria-label={searchPlaceholder}
                aria-controls={treeId}
                className="h-8 w-full border-0 bg-transparent text-label outline-none"
              />
            </div>
            <div className="min-h-0 overflow-auto p-1">
              {q ? (
                <ul id={treeId} role="tree" aria-label={ariaLabel} className="m-0 list-none p-0">
                  {matches.map((l) => leafRow(l, 1, true))}
                  {!matches.length && <li className="px-2 py-2 text-xs text-ui-secondary">{emptyText}</li>}
                </ul>
              ) : (
                <>
                  {recentLeaves.length > 0 && (
                    <>
                      <div className={sectionTitle}>{recentLabel}</div>
                      <ul role="tree" aria-label={recentLabel} className="m-0 mb-1 list-none border-b border-ui-border p-0 pb-1">
                        {recentLeaves.map((l) => leafRow(l, 1, true))}
                      </ul>
                    </>
                  )}
                  <ul id={treeId} role="tree" aria-label={ariaLabel} className="m-0 list-none p-0">
                    {nodes.map((n) => branch(n, 1, []))}
                    {!nodes.length && <li className="px-2 py-2 text-xs text-ui-secondary">{emptyText}</li>}
                  </ul>
                </>
              )}
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
