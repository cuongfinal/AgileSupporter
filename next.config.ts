import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  async redirects() {
    return [{ source: "/review", destination: "/sprint", permanent: false }];
  },
  // Native binaries / browser drivers must stay plain Node requires, not bundled.
  serverExternalPackages: ["playwright", "playwright-core", "ffmpeg-static"],
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
