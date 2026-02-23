/**
 * shop2 布局 - 提供 IntlProvider（zh）以便复用 WaterfallCard 等组件
 */
import { getMessages } from '@/lib/translations';
import { IntlProvider } from '@/components/providers/IntlProvider';

export default async function Shop2Layout({
  children,
}: {
  children: React.ReactNode;
}) {
  const messages = await getMessages('zh');
  return (
    <IntlProvider locale="zh" messages={messages}>
      {children}
    </IntlProvider>
  );
}
