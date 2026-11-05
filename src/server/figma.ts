import { HttpError } from "./api";
import { getSecret } from "./secrets";

export interface FigmaPreview {
  url: string;
  fileKey: string;
  nodeId: string | null;
  image: string | null;
  error?: string;
}

function parse(url: string): { fileKey: string; nodeId: string | null } | null {
  const m = url.match(/figma\.com\/(?:file|design|proto|board)\/([A-Za-z0-9]+)/);
  if (!m) return null;
  const node = new URL(url).searchParams.get("node-id");
  return { fileKey: m[1], nodeId: node ? node.replace("-", ":") : null };
}

async function figmaGet<T>(path: string, token: string): Promise<T> {
  const res = await fetch(`https://api.figma.com${path}`, { headers: { "X-Figma-Token": token }, signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw new Error(res.status === 403 ? "Figma: token has no access to this file" : `Figma: HTTP ${res.status}`);
  return (await res.json()) as T;
}

export async function testFigma(): Promise<string> {
  const token = await getSecret("figma.token");
  if (!token) throw new HttpError(400, "Figma token not set");
  const me = await figmaGet<{ handle?: string; email?: string }>("/v1/me", token);
  return me.handle || me.email || "ok";
}

export async function figmaPreviews(links: string[]): Promise<FigmaPreview[]> {
  const token = await getSecret("figma.token");
  if (!token) throw new HttpError(400, "Figma token not set (Settings → Figma)");
  const out: FigmaPreview[] = [];
  for (const url of links.slice(0, 8)) {
    const p = parse(url);
    if (!p) continue;
    try {
      if (p.nodeId) {
        const j = await figmaGet<{ images: Record<string, string | null> }>(
          `/v1/images/${p.fileKey}?ids=${encodeURIComponent(p.nodeId)}&format=png&scale=1`,
          token,
        );
        out.push({ url, ...p, image: j.images[p.nodeId] ?? null });
      } else {
        const j = await figmaGet<{ thumbnailUrl?: string }>(`/v1/files/${p.fileKey}?depth=1`, token);
        out.push({ url, ...p, image: j.thumbnailUrl ?? null });
      }
    } catch (e) {
      out.push({ url, ...p, image: null, error: e instanceof Error ? e.message : String(e) });
    }
  }
  return out;
}
