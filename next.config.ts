import path from "node:path";

import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["pdf-parse", "pdfjs-dist"],
  turbopack: {
    root: path.join(__dirname),
  },
};

export default nextConfig;
