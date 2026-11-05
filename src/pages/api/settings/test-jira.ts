import { api } from "@/server/api";
import { jiraMyself } from "@/server/jira";

export default api({ POST: async () => jiraMyself() });
