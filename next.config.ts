import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Next.js 16+：PPR 已合并到 cacheComponents，启用后静态壳 + 动态 Suspense 孔洞流式填充
  cacheComponents: true,
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "picsum.photos", pathname: "/**" },
    ],
  },
};

export default nextConfig;
