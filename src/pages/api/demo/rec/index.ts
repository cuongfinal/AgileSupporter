import { api } from "@/server/api";
import { recordingStatus } from "@/server/recorder";

export default api({ GET: async () => recordingStatus() });
