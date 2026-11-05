import { api } from "@/server/api";
import { pythonStatus, startPythonInstall } from "@/server/demo";

export default api({ GET: async () => pythonStatus(), POST: async () => startPythonInstall() });
