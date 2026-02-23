import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // reactCompiler 需安装 babel-plugin-react-compiler，否则会报错；不用则关闭
  // Next.js 16+：PPR 已合并到 cacheComponents，启用后静态壳 + 动态 Suspense 孔洞流式填充
  cacheComponents: true,
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "picsum.photos", pathname: "/**" },
    ],
  },
};

export default nextConfig;
