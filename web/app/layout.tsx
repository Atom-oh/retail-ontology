import type { Metadata } from 'next';
import localFont from 'next/font/local';
import './globals.css';

// Pretendard variable font hosted locally. Place pretendard-variable.woff2
// in public/fonts/. Falls back to system fonts via tailwind config.
const pretendard = localFont({
  src: '../public/fonts/pretendard-variable.woff2',
  display: 'swap',
  weight: '45 920',
  variable: '--font-pretendard',
});

export const metadata: Metadata = {
  title: 'Ontology Retail — Korean Retail/CPG 데모',
  description: 'AWS Bedrock + AgentCore + Neptune 기반 의미 검색 / 대화형 에이전트 / MD 인사이트',
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko" className={pretendard.variable}>
      <body className="font-sans antialiased min-h-screen">
        {children}
      </body>
    </html>
  );
}
