import fs from "node:fs";
import { z } from "zod";
import { api, query } from "@/server/api";
import { buildFile, listBuilds } from "@/server/demo";

const TYPES = {
  "deck.pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "deck.pdf": "application/pdf",
  "script.md": "text/markdown; charset=utf-8",
  "content.json": "application/json",
} as const;

export default api({
  GET: async (req, res) => {
    const id = query(req, "id");
    const name = z.enum(["deck.pptx", "deck.pdf", "script.md", "content.json"]).parse(query(req, "name"));
    const file = buildFile(id, name);
    const meta = listBuilds().find((b) => b.id === id);
    const base = `[Sprint Review] ${meta?.sprintName || "Sprint"}`.replace(/[^\w .()[\]–-]+/g, "_");
    const download = name === "script.md" ? `${base} - Demo Script.md` : name === "deck.pptx" ? `${base} (demo).pptx` : `${base} (demo)${name.slice(4)}`;
    res.setHeader("Content-Type", TYPES[name]);
    res.setHeader(
      "Content-Disposition",
      `${query(req, "inline") ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(download)}`,
    );
    res.status(200).send(fs.readFileSync(file));
    return undefined;
  },
});
