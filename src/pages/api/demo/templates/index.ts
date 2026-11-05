import type { NextApiRequest } from "next";
import { api, HttpError } from "@/server/api";
import { addTemplate, listTemplates } from "@/server/demo";

export const config = { api: { bodyParser: false } };
const MAX = 80 * 1024 * 1024;

async function readRaw(req: NextApiRequest): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX) throw new HttpError(413, "File too large (max 80 MB)");
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks);
}

export default api({
  GET: async () => listTemplates(),
  POST: async (req) => {
    const name = decodeURIComponent(String(req.headers["x-filename"] ?? "template.pptx"));
    if (!/\.pptx$/i.test(name)) throw new HttpError(400, "Only .pptx files are supported");
    return addTemplate(name, await readRaw(req));
  },
});
