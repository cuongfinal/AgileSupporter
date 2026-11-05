import { api } from "@/server/api";
import { detectFields } from "@/server/jira";

export default api({ POST: async () => detectFields() });
