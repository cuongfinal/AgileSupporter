import { api } from "@/server/api";
import { detectCli } from "@/server/ai";

export default api({ GET: async () => Promise.all([detectCli("claude"), detectCli("copilot")]) });
