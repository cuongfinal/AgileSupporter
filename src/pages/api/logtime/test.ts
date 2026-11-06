import { api } from "@/server/api";
import { testLogin } from "@/server/timeTracker";

export default api({ POST: async () => testLogin() });
