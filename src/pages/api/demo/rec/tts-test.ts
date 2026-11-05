import fs from "node:fs";
import { z } from "zod";
import { api, body } from "@/server/api";
import { speak } from "@/server/recorder/media";

export default api({
  POST: async (req, res) => {
    const { text } = body(req, z.object({ text: z.string().trim().min(1).max(400) }));
    const { file } = await speak(text);
    res.setHeader("Content-Type", "audio/mpeg");
    res.status(200).send(fs.readFileSync(file));
    return undefined;
  },
});
