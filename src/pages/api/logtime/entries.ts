import { api, query } from "@/server/api";
import { deleteLoggedTime, loggedTime } from "@/server/timeTracker";

export default api({
	GET: async (req, res) => {
		res.setHeader("Cache-Control", "no-store");
		return loggedTime(query(req, "from"), query(req, "to"));
	},
	DELETE: async (req) => deleteLoggedTime(query(req, "ids").split(",")),
});