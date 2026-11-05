import { z } from "zod";
import { api, body, query } from "@/server/api";
import { deleteRecording, getManifest, setSelected } from "@/server/recorder/store";
import { safeName } from "@/server/store";

export default api({
  GET: async (req) => ({ manifest: getManifest(safeName(query(req, "key"))) }),
  PUT: async (req) => {
    const b = body(req, z.object({ selected: z.array(z.string()).max(3) }));
    return setSelected(safeName(query(req, "key")), b.selected);
  },
  DELETE: async (req) => {
    deleteRecording(safeName(query(req, "key")));
    return { ok: true };
  },
});
