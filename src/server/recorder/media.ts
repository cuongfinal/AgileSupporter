import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { HttpError } from "../api";
import { run } from "../exec";
import { dataPath, ensureDir } from "../paths";
import { getSecret } from "../secrets";
import { getSettings } from "../settings";
import type { TtsProvider } from "@/lib/types";

export function ffmpegPath(): string {
  // Loaded lazily: the package resolves its downloaded binary at require time.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const p = require("ffmpeg-static") as string | null;
  if (!p || !fs.existsSync(p)) throw new HttpError(500, "ffmpeg binary missing — run `npm install` in the app folder again.");
  return p;
}

export function ffmpegAvailable(): boolean {
  try {
    ffmpegPath();
    return true;
  } catch {
    return false;
  }
}

async function ffmpeg(args: string[], timeoutMs = 10 * 60_000) {
  const r = await run(ffmpegPath(), ["-hide_banner", "-loglevel", "error", "-y", ...args], { timeoutMs });
  if (r.code !== 0) throw new Error(`ffmpeg failed: ${(r.stderr || r.stdout).slice(-600)}`);
}

/** Duration in ms, read from ffmpeg's header dump (no ffprobe in ffmpeg-static). */
export async function durationMs(file: string): Promise<number> {
  const r = await run(ffmpegPath(), ["-hide_banner", "-i", file], { timeoutMs: 30_000 });
  const m = /Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(r.stderr);
  if (!m) throw new Error(`Could not read the duration of ${path.basename(file)}`);
  return Math.round((Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3])) * 1000);
}

export async function webmToMp4(input: string, out: string): Promise<void> {
  await ffmpeg(["-i", input, "-c:v", "libx264", "-preset", "veryfast", "-crf", "23", "-pix_fmt", "yuv420p", "-movflags", "+faststart", out]);
}

/** Lays each narration clip at its offset under the video and encodes one mp4. */
export async function muxNarration(video: string, clips: { file: string; startMs: number }[], out: string): Promise<void> {
  if (!clips.length) return webmToMp4(video, out);
  const inputs = clips.flatMap((c) => ["-i", c.file]);
  const delayed = clips.map((c, i) => `[${i + 1}:a]adelay=${Math.max(0, c.startMs)}|${Math.max(0, c.startMs)}[a${i}]`);
  const mix = `${clips.map((_, i) => `[a${i}]`).join("")}amix=inputs=${clips.length}:normalize=0:dropout_transition=0[aout]`;
  await ffmpeg([
    "-i",
    video,
    ...inputs,
    "-filter_complex",
    [...delayed, mix].join(";"),
    "-map",
    "0:v",
    "-map",
    "[aout]",
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-crf",
    "23",
    "-pix_fmt",
    "yuv420p",
    "-c:a",
    "aac",
    "-b:a",
    "160k",
    "-movflags",
    "+faststart",
    out,
  ]);
}

// ---------------------------------------------------------------- text to speech

const macosSay = () => process.platform === "darwin" && fs.existsSync("/usr/bin/say");

/** The provider actually used: a cloud provider without its key falls back to the free offline macOS voice. */
export async function effectiveTts(): Promise<{ provider: TtsProvider | null; fallback: boolean }> {
  const { tts } = getSettings().recording;
  const ready =
    tts.provider === "openai"
      ? !!(await getSecret("openai.key"))
      : tts.provider === "elevenlabs"
        ? !!(await getSecret("elevenlabs.key")) && !!tts.elevenVoiceId
        : macosSay();
  if (ready) return { provider: tts.provider, fallback: false };
  return macosSay() ? { provider: "macos", fallback: tts.provider !== "macos" } : { provider: null, fallback: false };
}

export async function ttsConfigured(): Promise<boolean> {
  return (await effectiveTts()).provider !== null;
}

/** English voices installed on this Mac (novelty voices left out). */
export async function macVoices(): Promise<string[]> {
  if (!macosSay()) return [];
  const r = await run("/usr/bin/say", ["-v", "?"], { timeoutMs: 15_000 });
  const novelty = /^(Albert|Bad News|Bahh|Bells|Boing|Bubbles|Cellos|Fred|Good News|Jester|Junior|Kathy|Organ|Ralph|Superstar|Trinoids|Whisper|Wobble|Zarvox)\b/;
  return r.stdout
    .split("\n")
    .map((l) => /^(.+?)\s+([a-z]{2}_[A-Z]{2})\s+#/.exec(l))
    .filter((m): m is RegExpExecArray => !!m && m[2].startsWith("en_") && !novelty.test(m[1]))
    .map((m) => m[1].trim());
}

/** Synthesises one narration line to mp3 (cached by text + voice), returns the file and its length. */
export async function speak(text: string): Promise<{ file: string; ms: number }> {
  const { tts } = getSettings().recording;
  const { provider } = await effectiveTts();
  if (!provider) throw new HttpError(400, "No voice available — set an OpenAI / ElevenLabs key (Settings → Demo recording).");
  const voiceKey =
    provider === "openai" ? [tts.openaiModel, tts.openaiVoice, tts.instructions] : provider === "elevenlabs" ? [tts.elevenModel, tts.elevenVoiceId] : [tts.macVoice];
  const hash = crypto.createHash("sha256").update(JSON.stringify([provider, ...voiceKey, text])).digest("hex").slice(0, 32);
  const file = path.join(ensureDir(dataPath("cache", "tts")), `${hash}.mp3`);
  if (!fs.existsSync(file)) {
    if (provider === "macos") await macSpeech(text, tts.macVoice, file);
    else fs.writeFileSync(file, provider === "openai" ? await openaiSpeech(text) : await elevenSpeech(text));
  }
  return { file, ms: await durationMs(file) };
}

async function macSpeech(text: string, voice: string, out: string): Promise<void> {
  const aiff = `${out}.aiff`;
  const args = voice ? ["-v", voice, "-o", aiff, "--", text] : ["-o", aiff, "--", text];
  const r = await run("/usr/bin/say", args, { timeoutMs: 60_000 });
  if (r.code !== 0) throw new Error(`macOS voice failed: ${(r.stderr || r.stdout).slice(0, 300)}${voice ? ` (voice "${voice}")` : ""}`);
  try {
    await ffmpeg(["-i", aiff, "-ac", "1", "-ar", "44100", "-b:a", "128k", out]);
  } finally {
    fs.rmSync(aiff, { force: true });
  }
}

async function openaiSpeech(text: string): Promise<Buffer> {
  const key = await getSecret("openai.key");
  if (!key) throw new HttpError(400, "OpenAI API key is not set (Settings → Demo recording).");
  const { tts } = getSettings().recording;
  const body: Record<string, string> = { model: tts.openaiModel || "gpt-4o-mini-tts", voice: tts.openaiVoice || "alloy", input: text, response_format: "mp3" };
  if (tts.instructions && body.model.startsWith("gpt-4o")) body.instructions = tts.instructions;
  const res = await fetch("https://api.openai.com/v1/audio/speech", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) throw new Error(`OpenAI TTS: HTTP ${res.status} ${(await res.text()).slice(0, 300)}`);
  return Buffer.from(await res.arrayBuffer());
}

async function elevenSpeech(text: string): Promise<Buffer> {
  const key = await getSecret("elevenlabs.key");
  const { tts } = getSettings().recording;
  if (!key || !tts.elevenVoiceId) throw new HttpError(400, "ElevenLabs API key or voice ID is not set (Settings → Demo recording).");
  const res = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(tts.elevenVoiceId)}?output_format=mp3_44100_128`,
    {
      method: "POST",
      headers: { "xi-api-key": key, "Content-Type": "application/json", Accept: "audio/mpeg" },
      body: JSON.stringify({ text, model_id: tts.elevenModel || "eleven_multilingual_v2" }),
      signal: AbortSignal.timeout(60_000),
    },
  );
  if (!res.ok) throw new Error(`ElevenLabs TTS: HTTP ${res.status} ${(await res.text()).slice(0, 300)}`);
  return Buffer.from(await res.arrayBuffer());
}
