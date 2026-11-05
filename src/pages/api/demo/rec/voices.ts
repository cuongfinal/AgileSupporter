import { api } from "@/server/api";
import { macVoices } from "@/server/recorder/media";

export default api({ GET: async () => ({ mac: await macVoices() }) });
