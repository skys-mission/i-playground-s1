import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // better-sqlite3 是原生模块，不能被打包进 bundle
  serverExternalPackages: ["better-sqlite3"],
};

export default nextConfig;
