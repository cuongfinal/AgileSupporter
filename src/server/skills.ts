import fs from "node:fs";
import path from "node:path";
import { skillsDir } from "./settings";

export interface SkillInfo {
  name: string;
  description: string;
  dir: string;
  files: string[];
}

function frontmatter(md: string): Record<string, string> {
  const m = md.match(/^---\n([\s\S]*?)\n---/);
  if (!m) return {};
  const out: Record<string, string> = {};
  let current = "";
  for (const line of m[1].split("\n")) {
    const kv = line.match(/^([A-Za-z_-]+):\s*(.*)$/);
    if (kv) {
      current = kv[1];
      out[current] = kv[2].replace(/^[>|]-?\s*$/, "").replace(/^["']|["']$/g, "");
    } else if (current) {
      out[current] = `${out[current]} ${line.trim()}`.trim();
    }
  }
  return out;
}

function listFiles(dir: string, base = dir): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    if (e.name.startsWith(".") || e.name === "__pycache__") return [];
    const full = path.join(dir, e.name);
    return e.isDirectory() ? listFiles(full, base) : [path.relative(base, full)];
  });
}

export function listSkills(): { root: string; skills: SkillInfo[]; references: string[] } {
  const root = skillsDir();
  if (!fs.existsSync(root)) return { root, skills: [], references: [] };
  const skills = fs
    .readdirSync(root, { withFileTypes: true })
    .filter((e) => e.isDirectory() && fs.existsSync(path.join(root, e.name, "SKILL.md")))
    .map((e) => {
      const dir = path.join(root, e.name);
      const fm = frontmatter(fs.readFileSync(path.join(dir, "SKILL.md"), "utf8"));
      return { name: fm.name || e.name, description: fm.description || "", dir, files: listFiles(dir) };
    });
  const refDir = path.join(root, "references");
  const references = fs.existsSync(refDir) ? listFiles(refDir) : [];
  return { root, skills, references };
}

export function readSkillFile(...parts: string[]): string {
  const file = path.join(skillsDir(), ...parts);
  return fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
}
