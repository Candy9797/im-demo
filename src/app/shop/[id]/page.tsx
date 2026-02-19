import Link from 'next/link';

export default async function ShopDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <main className="tb-page" style={{ padding: '40px 20px', textAlign: 'center' }}>
      <p style={{ marginBottom: 16 }}>商品 {id} 详情页开发中</p>
      <Link href="/shop" className="tb-btn">
        返回列表
      </Link>
    </main>
  );
}
