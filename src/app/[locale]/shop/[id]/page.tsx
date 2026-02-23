import Link from 'next/link';
import { shopPath, getLocale } from '@/lib/i18n';
import { getTranslations } from '@/lib/translations';

export default async function ShopDetailPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale: rawLocale, id } = await params;
  const locale = getLocale(rawLocale);
  const t = await getTranslations(locale, 'shop');

  return (
    <main className="tb-page" style={{ padding: '40px 20px', textAlign: 'center' }}>
      <p style={{ marginBottom: 16 }}>{t('detailDeveloping', { id })}</p>
      <Link href={shopPath('', locale)} className="tb-btn">
        {t('backList')}
      </Link>
    </main>
  );
}
