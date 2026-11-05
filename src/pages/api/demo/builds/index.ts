import { api } from "@/server/api";
import { listBuilds } from "@/server/demo";

export default api({ GET: async () => listBuilds() });
