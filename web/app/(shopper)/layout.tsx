import Link from 'next/link';

export default function ShopperLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen flex flex-col">
      <header className="border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
        <div className="mx-auto max-w-7xl px-6 h-14 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-3">
            <span className="inline-block w-2 h-2 rounded-full bg-brand-500" />
            <span className="font-semibold">Ontology Retail · Shopper</span>
          </Link>
          <nav className="flex gap-4 text-sm">
            <Link href="/search" className="hover:text-brand-600">검색</Link>
            <Link href="/chat" className="hover:text-brand-600">에이전트</Link>
            <Link href="/" className="text-slate-400 hover:text-slate-600">↩ 홈</Link>
          </nav>
        </div>
      </header>
      <main className="flex-1">{children}</main>
    </div>
  );
}
