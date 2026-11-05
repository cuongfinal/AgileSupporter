// TS port of .claude/skills/jira-story-breakdown/scripts/extract_fields.py, extended to keep link targets.

interface AdfNode {
  type?: string;
  text?: string;
  content?: AdfNode[];
  attrs?: Record<string, unknown>;
  marks?: { type: string; attrs?: Record<string, unknown> }[];
}

function applyMarks(text: string, marks: AdfNode["marks"]): string {
  let out = text;
  for (const m of marks ?? []) {
    if (m.type === "strong") out = `**${out}**`;
    else if (m.type === "em") out = `_${out}_`;
    else if (m.type === "code") out = `\`${out}\``;
    else if (m.type === "strike") out = `~~${out}~~`;
    else if (m.type === "link" && typeof m.attrs?.href === "string") out = `[${out}](${m.attrs.href})`;
  }
  return out;
}

function walk(node: unknown, depth: number, ordered = false): string {
  if (node == null) return "";
  if (typeof node === "string") return node;
  if (Array.isArray(node)) return node.map((n) => walk(n, depth, ordered)).join("");
  if (typeof node !== "object") return String(node);

  const n = node as AdfNode;
  const content = n.content;
  switch (n.type) {
    case "text":
      return applyMarks(n.text ?? "", n.marks);
    case "hardBreak":
      return "\n";
    case "paragraph":
      return walk(content, depth) + "\n\n";
    case "heading": {
      const level = Number(n.attrs?.level ?? 1);
      return `${"#".repeat(Math.min(6, level))} ${walk(content, depth).trim()}\n\n`;
    }
    case "bulletList":
      return walk(content, depth + 1, false) + (depth === 0 ? "\n" : "");
    case "orderedList":
      return walk(content, depth + 1, true) + (depth === 0 ? "\n" : "");
    case "listItem": {
      const bullet = "  ".repeat(Math.max(0, depth - 1)) + (ordered ? "1. " : "- ");
      const inner = walk(content, depth)
        .replace(/\n{2,}/g, "\n")
        .trim()
        .replace(/\n/g, "\n" + "  ".repeat(depth));
      return bullet + inner + "\n";
    }
    case "codeBlock":
      return "```\n" + walk(content, depth) + "\n```\n\n";
    case "blockquote":
      return (
        walk(content, depth)
          .trim()
          .split("\n")
          .map((l) => `> ${l}`)
          .join("\n") + "\n\n"
      );
    case "rule":
      return "---\n\n";
    case "mention":
      return `@${String(n.attrs?.text ?? "").replace(/^@/, "")}`;
    case "emoji":
      return String(n.attrs?.text ?? n.attrs?.shortName ?? "");
    case "inlineCard":
    case "blockCard":
    case "embedCard": {
      const url = String(n.attrs?.url ?? "");
      return url ? `<${url}>` + (n.type === "inlineCard" ? "" : "\n\n") : "";
    }
    case "status":
      return `[${String(n.attrs?.text ?? "")}]`;
    case "date":
      return n.attrs?.timestamp ? new Date(Number(n.attrs.timestamp)).toISOString().slice(0, 10) : "";
    case "mediaSingle":
    case "mediaGroup":
      return "_[attachment]_\n\n";
    case "media":
      return "";
    case "panel":
      return walk(content, depth);
    case "table": {
      const rows = (content ?? []).map((row) =>
        (row.content ?? []).map((cell) => walk(cell.content, depth).replace(/\n+/g, " ").replace(/\|/g, "\\|").trim()),
      );
      if (!rows.length) return "";
      const width = Math.max(...rows.map((r) => r.length));
      const pad = (r: string[]) => [...r, ...Array(width - r.length).fill("")];
      const lines = [pad(rows[0]), Array(width).fill("---"), ...rows.slice(1).map(pad)];
      return lines.map((r) => `| ${r.join(" | ")} |`).join("\n") + "\n\n";
    }
    default:
      return content ? walk(content, depth, ordered) : "";
  }
}

export function adfToMarkdown(node: unknown): string {
  if (node == null) return "";
  if (typeof node === "string") return node.trim();
  return walk(node, 0)
    .split("\n")
    .map((l) => l.trimEnd())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
