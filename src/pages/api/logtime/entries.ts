import { api, query } from "@/server/api";
import { loggedTime } from "@/server/timeTracker";

export default api({
	GET: async (req, res) => {
		res.setHeader("Cache-Control", "no-store");
		return loggedTime(query(req, "from"), query(req, "to"));
	},
});