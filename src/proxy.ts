import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

/** Local-only app: reject foreign Host headers (DNS rebinding) and cross-site writes (CSRF). */
export function proxy(request: NextRequest) {
  const host = (request.headers.get("host") ?? "").replace(/:\d+$/, "");
  if (!LOCAL_HOSTS.has(host)) return new NextResponse("Forbidden host", { status: 403 });
  if (request.method !== "GET" && request.method !== "HEAD") {
    const origin = request.headers.get("origin");
    if (origin) {
      const o = new URL(origin).hostname;
      if (!LOCAL_HOSTS.has(o) && !LOCAL_HOSTS.has(`[${o}]`)) return new NextResponse("Forbidden origin", { status: 403 });
    }
  }
  return NextResponse.next();
}

export const config = { matcher: "/api/:path*" };
