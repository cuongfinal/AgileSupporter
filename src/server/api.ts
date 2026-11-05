import type { NextApiHandler, NextApiRequest, NextApiResponse } from "next";
import { z } from "zod";

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

type Method = "GET" | "POST" | "PUT" | "DELETE";
type Handler = (req: NextApiRequest, res: NextApiResponse) => Promise<unknown>;

/** Handlers return a value to send as JSON, or `undefined` after writing the response themselves. */
export function api(handlers: Partial<Record<Method, Handler>>): NextApiHandler {
  return async (req, res) => {
    const handler = handlers[req.method as Method];
    if (!handler) {
      res.setHeader("Allow", Object.keys(handlers).join(", "));
      res.status(405).json({ error: "Method not allowed" });
      return;
    }
    try {
      const out = await handler(req, res);
      if (!res.headersSent) res.status(200).json(out ?? { ok: true });
    } catch (e) {
      const status = e instanceof HttpError ? e.status : e instanceof z.ZodError ? 400 : 500;
      const message =
        e instanceof z.ZodError
          ? e.issues.map((i) => `${i.path.join(".") || "body"}: ${i.message}`).join("; ")
          : e instanceof Error
            ? e.message
            : String(e);
      if (status === 500) console.error(`[api] ${req.method} ${req.url}:`, e);
      if (!res.headersSent) res.status(status).json({ error: message });
    }
  };
}

export function body<T>(req: NextApiRequest, schema: z.ZodType<T>): T {
  return schema.parse(req.body ?? {});
}

export function query(req: NextApiRequest, name: string): string {
  const v = req.query[name];
  return (Array.isArray(v) ? v[0] : v) ?? "";
}
