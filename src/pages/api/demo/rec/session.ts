import { z } from "zod";
import { api, body } from "@/server/api";
import { clearSession, closeLogin, openLogin, saveLogin } from "@/server/recorder/browser";
import { requireEnabled } from "@/server/recorder";

export default api({
  POST: async (req) => {
    requireEnabled();
    const { action } = body(req, z.object({ action: z.enum(["open", "save", "close", "clear"]) }));
    if (action === "open") await openLogin();
    else if (action === "save") await saveLogin();
    else if (action === "close") await closeLogin();
    else clearSession();
    return { ok: true };
  },
});
