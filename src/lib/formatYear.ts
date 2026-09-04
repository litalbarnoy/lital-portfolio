// Writes a span of years the way the CV states it: a single year, a closed
// range, or an open one that is still running.

import type { Lang } from "../i18n/ui";

export interface YearSpan {
  year: number;
  yearEnd?: number;
  ongoing?: boolean;
}

const PRESENT: Record<Lang, string> = {
  he: "היום",
  en: "Present",
};

export function formatYear(span: YearSpan, lang: Lang): string {
  const { year, yearEnd, ongoing } = span;
  // An en dash, and always start–end in reading order: these are numerals,
  // which stay left-to-right inside a right-to-left line either way.
  if (ongoing) return `${year} – ${PRESENT[lang]}`;
  if (yearEnd && yearEnd !== year) return `${year}–${yearEnd}`;
  return String(year);
}
