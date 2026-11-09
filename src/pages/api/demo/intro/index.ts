import type { NextApiRequest } from "next";
import { api, HttpError } from "@/server/api";
import { saveIntroImage, templateIntro } from "@/server/demo";

export const config = { api: { bodyParser: false } };
const MAX = 20 * 1024 * 1024;

async function readRaw(req: NextApiRequest): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX) throw new HttpError(413, "Image too large (max 20 MB)");
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks);
}

export default api({
  /** The active template's opening slides: editable text boxes and screenshot slots. */
  GET: async () => templateIntro(),
  /** Uploads a screenshot (raw PNG / JPEG body) for an opening-slide slot. */
  POST: async (req) => saveIntroImage(await readRaw(req)),
});
