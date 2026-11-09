import fs from "node:fs";
import { api, query } from "@/server/api";
import { introImageFile } from "@/server/demo";

/** ?name=<upload> for an uploaded screenshot, or ?tpl=<templateId>&name=<preview> for the template's own picture. */
export default api({
  GET: async (req, res) => {
    const tpl = typeof req.query.tpl === "string" && req.query.tpl ? req.query.tpl : undefined;
    const { file, type } = introImageFile(query(req, "name"), tpl);
    res.setHeader("Content-Type", type);
    res.setHeader("Cache-Control", "private, max-age=31536000, immutable");
    res.status(200).send(fs.readFileSync(file));
    return undefined;
  },
});
