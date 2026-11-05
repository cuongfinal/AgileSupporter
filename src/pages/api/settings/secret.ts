import { z } from "zod";
import { api, body, query } from "@/server/api";
import { deleteSecret, SECRET_NAMES, setSecret, type SecretName } from "@/server/secrets";
import { publicSettings } from "@/server/settings";

const name = z.enum(SECRET_NAMES as [SecretName, ...SecretName[]]);

export default api({
  PUT: async (req) => {
    const b = body(req, z.object({ name, value: z.string().trim().min(1) }));
    await setSecret(b.name, b.value);
    return publicSettings();
  },
  DELETE: async (req) => {
    deleteSecret(name.parse(query(req, "name")));
    return publicSettings();
  },
});
