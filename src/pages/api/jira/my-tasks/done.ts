import { z } from "zod";
import { api, body } from "@/server/api";
import { startMoveToDone } from "@/server/myTasks";

export default api({
  POST: async (req) => {
    const b = body(
      req,
      z.object({
        sprintId: z.number().int().positive(),
        items: z
          .array(z.object({ key: z.string().regex(/^[A-Z][A-Z0-9]+-\d+$/), score: z.union([z.literal(4), z.literal(5)]), to: z.string().min(1).max(80) }))
          .min(1)
          .max(200),
      }),
    );
    return startMoveToDone(b.sprintId, b.items);
  },
});
