import { LandingHero } from '@/components/LandingHero';
import { ChatWidget } from '@/components/ChatWidget';

/**
 * 首页 - App Router 默认 RSC
 * 无 'use client' → 服务端组件，SSR 时在 Node 执行
 * 子组件若无 'use client' 也是 RSC；ChatWidget 有 'use client' → 客户端边界
 */
export default function Home() {
  return (
    <main>
      <LandingHero />
      <ChatWidget />
    </main>
  );
}
