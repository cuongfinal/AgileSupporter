import { api } from "@/server/api";
import { listSprints } from "@/server/jira";

export default api({ GET: async () => listSprints() });
