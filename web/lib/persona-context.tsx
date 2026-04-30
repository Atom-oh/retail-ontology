'use client';

// PersonaContext — global "active persona" state for the demo. Widgets
// in the topbar (PersonaSwitch) write; scenario pages (search, match,
// chat) read. Backed by localStorage so the choice survives reload but
// scoped to the browser (no server cookie — multi-user demos can show
// different personas in different tabs).
//
// Why this exists: each scenario page used to take "persona" via its own
// dropdown or rely on backend default. With 40 personas the natural
// demo flow is "select 임산부 김연주, then click through scenarios A/D/E"
// — so persona belongs on the global topbar.

import { createContext, useContext, useEffect, useState } from 'react';

const STORAGE_KEY = 'ontology-retail.active-persona';

export type ActivePersona = {
  id: string;
  label: string;
} | null;

type Ctx = {
  active: ActivePersona;
  setActive: (p: ActivePersona) => void;
};

const PersonaCtx = createContext<Ctx | null>(null);

export function PersonaProvider({ children }: { children: React.ReactNode }) {
  const [active, setActiveState] = useState<ActivePersona>(null);

  // Hydrate from localStorage on mount (client-only — SSR-safe).
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) setActiveState(JSON.parse(raw));
    } catch {
      // ignore parse / quota errors; fall back to "no active persona"
    }
  }, []);

  const setActive = (p: ActivePersona) => {
    setActiveState(p);
    try {
      if (p) localStorage.setItem(STORAGE_KEY, JSON.stringify(p));
      else localStorage.removeItem(STORAGE_KEY);
    } catch {
      // localStorage may be disabled in some browser modes; silent fallback
    }
  };

  return <PersonaCtx.Provider value={{ active, setActive }}>{children}</PersonaCtx.Provider>;
}

export function useActivePersona(): Ctx {
  const v = useContext(PersonaCtx);
  if (!v) throw new Error('useActivePersona must be used within <PersonaProvider>');
  return v;
}
