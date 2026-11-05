import { api } from "@/server/api";
import { listSkills } from "@/server/skills";

export default api({ GET: async () => listSkills() });
