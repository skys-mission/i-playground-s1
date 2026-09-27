import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // 发布用：产出 .next/standalone，可不做全量 pnpm install 直接运行
  output: "standalone",
  // better-sqlite3 是原生模块，不能被打包进 bundle
  serverExternalPackages: ["better-sqlite3"],
  // standalone 追踪默认只带构建平台那份原生二进制；发布包需要覆盖全部平台
  outputFileTracingIncludes: {
    "/*": ["node_modules/better-sqlite3/prebuilds/*.node"],
  },
};

export default nextConfig;
