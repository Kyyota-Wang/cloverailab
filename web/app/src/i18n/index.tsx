import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { en } from "./en";
import { zh } from "./zh";

/**
 * Interface chrome is translated; model output is not.
 *
 * The commentary, the generated essays, the suggestions and the topics are all
 * English because the exam is in English -- translating a rater's comment on
 * English prose into Chinese would destroy the thing the reader needs to see.
 * So the dictionary covers labels, buttons and explanations only.
 */

export type Lang = "en" | "zh";
export type Dict = typeof en;

const DICTS: Record<Lang, Dict> = { en, zh };

const STORAGE_KEY = "clover.lang";

function initialLang(): Lang {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === "en" || saved === "zh") return saved;
  } catch {
    /* private mode */
  }
  return navigator.language?.toLowerCase().startsWith("zh") ? "zh" : "en";
}

interface I18n {
  lang: Lang;
  setLang: (next: Lang) => void;
  t: Dict;
}

const Ctx = createContext<I18n | null>(null);

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(initialLang);

  useEffect(() => {
    document.documentElement.lang = lang === "zh" ? "zh-CN" : "en";
  }, [lang]);

  const setLang = useCallback((next: Lang) => {
    setLangState(next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      /* private mode */
    }
  }, []);

  const value = useMemo<I18n>(
    () => ({ lang, setLang, t: DICTS[lang] }),
    [lang, setLang],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useI18n(): I18n {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useI18n must be used inside I18nProvider");
  return ctx;
}
