import { api } from "@/server/api";
import { autoDetectFields } from "@/server/jira";

export default api({ POST: async () => autoDetectFields() });
