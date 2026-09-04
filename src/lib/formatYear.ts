// Writes a span of years the way the CV states it: a single year, a closed
// range, or an open one that is still running.

import type { Lang } from "../i18n/ui";

export interface YearSpan {
  year: number;
  yearEnd?: number;
  ongoing?: boolean;
}

const PRESENT: Record<Lang, string> = {
  he: "עד היום",
  en: "to Present",
};

export function formatYear(span: YearSpan, lang: Lang): string {
  const { year, yearEnd, ongoing } = span;
  // A closed range keeps its en dash: it is the convention for numerals, and
  // a comma there would read as two separate years. An open range spells the
  // word instead, so no dash is left standing next to text.
  if (ongoing) return `${year} ${PRESENT[lang]}`;
  if (yearEnd && yearEnd !== year) return `${year}–${yearEnd}`;
  return String(year);
}
