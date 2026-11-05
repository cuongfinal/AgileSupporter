import { api } from "@/server/api";
import { testFigma } from "@/server/figma";

export default api({ POST: async () => ({ account: await testFigma() }) });
