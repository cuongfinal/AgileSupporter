import fs from "node:fs";
import path from "node:path";
import { api, query } from "@/server/api";
import { recordingFile } from "@/server/recorder/store";
import { safeName } from "@/server/store";

const TYPES: Record<string, string> = { ".png": "image/png", ".mp4": "video/mp4", ".mp3": "audio/mpeg", ".webm": "video/webm" };

export default api({
  GET: async (req, res) => {
    const key = safeName(query(req, "key"));
    const name = query(req, "name");
    const file = recordingFile(key, name);
    const size = fs.statSync(file).size;
    res.setHeader("Content-Type", TYPES[path.extname(file)] ?? "application/octet-stream");
    res.setHeader("Accept-Ranges", "bytes");
    res.setHeader("Cache-Control", "no-store");
    if (query(req, "download")) res.setHeader("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent(`${key}-${name}`)}`);
    // Range support lets the <video> element seek.
    const m = /^bytes=(\d*)-(\d*)$/.exec(String(req.headers.range ?? ""));
    if (m) {
      const start = m[1] ? Number(m[1]) : 0;
      const end = m[2] ? Math.min(Number(m[2]), size - 1) : size - 1;
      res.status(206).setHeader("Content-Range", `bytes ${start}-${end}/${size}`);
      res.setHeader("Content-Length", end - start + 1);
      fs.createReadStream(file, { start, end }).pipe(res);
      await new Promise((r) => res.on("close", r));
      return undefined;
    }
    res.setHeader("Content-Length", size);
    fs.createReadStream(file).pipe(res);
    await new Promise((r) => res.on("close", r));
    return undefined;
  },
});

export const config = { api: { responseLimit: false } };
