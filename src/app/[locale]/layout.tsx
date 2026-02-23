/**
 * 国际化段布局 - 仅包裹 [locale] 下的路由（如 /zh/shop、/en/shop）
 * 提供 IntlProvider，子组件可用 useTranslations() 取文案
 * params 在 Suspense 内访问，避免 Next.js 15+ blocking-route 报错
 */
import { Suspense } from 'react';
import { getLocale } from '@/lib/i18n';
import { getMessages } from '@/lib/translations';
import { IntlProvider } from '@/components/providers/IntlProvider';

async function LocaleLayoutContent({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale: raw } = await params;
  const locale = getLocale(raw);
  const messages = await getMessages(locale);
  return (
    <IntlProvider key={locale} locale={locale} messages={messages}>
      {children}
    </IntlProvider>
  );
}

function LocaleLayoutFallback() {
  return (
    <div style={{ minHeight: '100vh', padding: '1rem', background: 'var(--tb-bg, #f5f5f5)' }}>
      <div className="wf-skeleton" />
    </div>
  );
}

export default function LocaleLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  return (
    <Suspense fallback={<LocaleLayoutFallback />}>
      <LocaleLayoutContent params={params}>{children}</LocaleLayoutContent>
    </Suspense>
  );
}
