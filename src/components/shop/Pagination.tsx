'use client';

import React from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';

interface PaginationProps {
  page: number;
  total: number;
  pageSize: number;
}

export function Pagination({ page, total, pageSize }: PaginationProps) {
  const searchParams = useSearchParams();
  const totalPages = Math.ceil(total / pageSize) || 1;
  if (totalPages <= 1) return null;

  const buildUrl = (p: number) => {
    const params = new URLSearchParams(searchParams.toString());
    if (p <= 1) params.delete('page');
    else params.set('page', String(p));
    const s = params.toString();
    return s ? `/shop?${s}` : '/shop';
  };

  const pages: number[] = [];
  const delta = 2;
  for (let i = Math.max(1, page - delta); i <= Math.min(totalPages, page + delta); i++) {
    pages.push(i);
  }

  return (
    <nav className="wf-pagination" aria-label="分页">
      {page > 1 ? (
        <Link href={buildUrl(page - 1)} className="wf-page-btn">
          上一页
        </Link>
      ) : (
        <span className="wf-page-btn disabled">上一页</span>
      )}

      <div className="wf-page-nums">
        {pages[0] > 1 && (
          <>
            <Link href={buildUrl(1)} className="wf-page-num">1</Link>
            {pages[0] > 2 && <span className="wf-page-ellipsis">...</span>}
          </>
        )}
        {pages.map((p) => (
          <Link
            key={p}
            href={buildUrl(p)}
            className={`wf-page-num ${p === page ? 'active' : ''}`}
          >
            {p}
          </Link>
        ))}
        {pages[pages.length - 1] < totalPages && (
          <>
            {pages[pages.length - 1] < totalPages - 1 && (
              <span className="wf-page-ellipsis">...</span>
            )}
            <Link href={buildUrl(totalPages)} className="wf-page-num">
              {totalPages}
            </Link>
          </>
        )}
      </div>

      {page < totalPages ? (
        <Link href={buildUrl(page + 1)} className="wf-page-btn">
          下一页
        </Link>
      ) : (
        <span className="wf-page-btn disabled">下一页</span>
      )}
    </nav>
  );
}
