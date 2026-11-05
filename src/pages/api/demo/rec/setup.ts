import { api } from "@/server/api";
import { requireEnabled } from "@/server/recorder";
import { startBrowserInstall } from "@/server/recorder/browser";

export default api({
  POST: async () => {
    requireEnabled();
    return startBrowserInstall();
  },
});
