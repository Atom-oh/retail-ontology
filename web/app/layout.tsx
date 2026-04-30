import type { Metadata } from 'next';
import { Noto_Sans_KR } from 'next/font/google';
import './globals.css';

import { PersonaProvider } from '@/lib/persona-context';
import { Sidebar } from '@/components/Sidebar';
import { PersonaSwitch } from '@/components/PersonaSwitch';
import { GuidedTour } from '@/components/GuidedTour';

// Pretendard isn't on Google Fonts and the GitHub release ZIP exceeds
// CDN limits — using Noto Sans KR (Google Fonts CDN-friendly) for reliable
// builds. Replace with Pretendard via next/font/local once font CDN is set up.
const pretendard = Noto_Sans_KR({
  subsets: ['latin'],
  weight: ['400', '500', '700', '900'],
  display: 'swap',
  variable: '--font-pretendard',
});

export const metadata: Metadata = {
  title: 'Ontology Retail — Korean Retail/CPG 데모',
  description: 'AWS Bedrock + AgentCore + Neptune 기반 의미 검색 / 대화형 에이전트 / MD 인사이트',
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  // Two-column shell rebuilt from the 4/28 deployed image: left rail Sidebar
  // (full menu — scenarios A–K, meta, Knowledge Graph object types, ops) +
  // main pane with absolute-positioned PersonaSwitch + GuidedTour widgets in
  // the top-right. Pages render full-width inside <main>, so each scenario
  // page keeps its own min-h-screen + header.
  return (
    <html lang="ko" className={`${pretendard.variable} dark`}>
      <body className="font-sans antialiased min-h-screen bg-ink-950 text-ink-200">
        <PersonaProvider>
          <div className="flex min-h-screen">
            <Sidebar />
            <main className="flex-1 min-w-0 overflow-x-hidden relative">
              <div className="absolute top-3 right-6 z-30 flex items-center gap-2">
                <GuidedTour />
                <PersonaSwitch />
              </div>
              {children}
            </main>
          </div>
        </PersonaProvider>
      </body>
    </html>
  );
}
