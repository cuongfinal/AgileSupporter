import { z } from "zod";
import { api, body, HttpError, query } from "@/server/api";
import { deleteBoard, retroView, saveCards } from "@/server/retro";

const bi = z.object({ en: z.string().max(2000), vi: z.string().max(2000) });
const card = z.object({
  id: z.string().min(1).max(64),
  column: z.enum(["well", "improve", "action"]),
  title: bi,
  detail: bi,
  evidence: z.array(z.string().max(40)).max(30),
  metric: z.object({ en: z.string().max(200), vi: z.string().max(200) }),
  source: z.enum(["ai", "manual"]),
  edited: z.boolean().optional(),
  pushed: z.boolean().optional(),
});

function sprintId(raw: unknown): number {
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) throw new HttpError(400, "Pick a sprint");
  return id;
}

export default api({
  GET: async (req) => retroView(sprintId(query(req, "sprintId"))),
  PUT: async (req) => {
    const b = body(
      req,
      z.object({ sprintId: z.number().int(), sprintName: z.string().max(200), cards: z.array(card).max(200), notes: z.string().max(5000).optional() }),
    );
    return saveCards(sprintId(b.sprintId), b.sprintName, b.cards, b.notes);
  },
  DELETE: async (req) => {
    deleteBoard(sprintId(query(req, "sprintId")));
    return { ok: true };
  },
});
