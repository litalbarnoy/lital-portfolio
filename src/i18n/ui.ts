export type Lang = "he" | "en";

export const ui = {
  he: {
    dir: "rtl",
    nav: {
      home: "בית",
      productDesign: "עיצוב חוויית משתמש",
      curatorial: "אוצרות",
      academic: "מחקר אקדמי",
      about: "אודות",
    },
    footer: {
      tagline: "עיצוב חוויית משתמש ואוצרות",
      rights: "כל הזכויות שמורות",
      linkedin: "לינקדאין",
    },
    project: {
      role: "תפקיד",
      company: "חברה",
      venue: "מקום",
      institution: "מוסד",
      year: "שנה",
      tags: "תגיות",
      next: "הפרויקט הבא",
      allProjects: "לכל הפרויקטים",
      cardView: "תצוגת כרטיסים",
      listView: "תצוגת רשימה",
      prev: "הקודם",
      nextImage: "הבא",
      link: "קישור",
      links: "קישורים",
      gallery: "גלריית התמונות",
      close: "סגירה",
      enlargeHint: "לחצו על תמונה להגדלה",
    },
  },
  en: {
    dir: "ltr",
    nav: {
      home: "Home",
      productDesign: "Product Design",
      curatorial: "Curatorial",
      academic: "Academic Research",
      about: "About",
    },
    footer: {
      tagline: "UX Design & Curatorial Work",
      rights: "All rights reserved",
      linkedin: "LinkedIn",
    },
    project: {
      role: "Role",
      company: "Company",
      venue: "Venue",
      institution: "Institution",
      year: "Year",
      tags: "Tags",
      next: "Next Project",
      allProjects: "View all projects",
      cardView: "Card View",
      listView: "List View",
      prev: "Previous",
      nextImage: "Next",
      link: "Link",
      links: "Links",
      gallery: "Image gallery",
      close: "Close",
      enlargeHint: "Click any image to enlarge",
    },
  },
} as const;

export function getLang(pathname: string): Lang {
  return pathname.startsWith("/en") ? "en" : "he";
}

export function stripLocale(id: string): string {
  return id.replace(/^(he|en)\//, "");
}

export function localizePath(pathname: string, lang: Lang): string {
  const withoutLocale = pathname.replace(/^\/en/, "") || "/";
  return lang === "en"
    ? `/en${withoutLocale === "/" ? "" : withoutLocale}` || "/en"
    : withoutLocale;
}
