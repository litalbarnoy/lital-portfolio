// CV entries that are listed but do not have a page of their own. Plain
// text, not links — there is nothing behind them to open.

import type { Lang } from "../i18n/ui";

export interface Publication {
  title: string;
  venue: string;
  role: string;
  year: number;
}

export const publications: Record<Lang, Publication[]> = {
  he: [
    {
      title: "כתב העת של בצלאל לתרבות חזותית וחומרית #9",
      venue: "מאמר שפיט, בשיתוף האדריכלית בר מוסאן לוי",
      role: "מחברת",
      year: 2023,
    },
    {
      title: "הכנס הארצי לתלמידי מחקר בתולדות האמנות, העיצוב והתרבות החזותית",
      venue: "הרצאה משותפת עם האדריכלית בר מוסאן לוי",
      role: "מרצה",
      year: 2022,
    },
    {
      title: "״TRANS״, בצלאל אקדמיה לאמנות ועיצוב",
      venue: "טרנספורמציה, סימולקרה והיפר־ריאליות במופעי הדראג קווין ׳ליפסינקה׳",
      role: "מרצה",
      year: 2020,
    },
    {
      title: "Rundgang, האקדמיה לאמנויות וינה",
      venue: "The Quote Machine, מחקר והתקנה, במסגרת התערוכה To Work The Room",
      role: "מחקר והתקנה",
      year: 2019,
    },
  ],
  en: [
    {
      title: "Bezalel Journal of Visual and Material Culture #9",
      venue: "Peer-reviewed article, with Architect Bar Mussan Levi",
      role: "Author",
      year: 2023,
    },
    {
      title:
        "The National Conference for Graduate Students in Art History, Design and Visual Culture",
      venue: "Joint lecture with Architect Bar Mussan Levi",
      role: "Lecturer",
      year: 2022,
    },
    {
      title: "“TRANS”, Bezalel Academy of Arts and Design",
      venue:
        "Transformation, Simulacra and Hyper-reality in the Performances of the Drag Queen ‘Lypsinka’",
      role: "Lecturer",
      year: 2020,
    },
    {
      title: "Rundgang, Akademie der bildenden Künste Wien",
      venue:
        "The Quote Machine, research and installation, part of To Work The Room",
      role: "Research and Installation",
      year: 2019,
    },
  ],
};
