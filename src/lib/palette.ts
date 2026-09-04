// The scroll-driven palette. Sections carry a named pair; the layout writes
// it out as the data-* attributes the observer reads, so a hex is only ever
// written down here.
//
// Pastel backgrounds with white text, following the reference. Worth knowing
// what that costs: white on these lands at roughly 2.2-2.5:1, and on the
// reference's own pastels at 1.6-1.8:1. The backgrounds here are already
// pushed to the deep end of pastel, which is as far as white text can be
// helped without the colours ceasing to read as pastel at all. The same
// backgrounds with dark text would be 7:1+.
//
// So this is a deliberate trade of legibility for the look, made knowingly.
// Flipping it back is five values: put the dark inks in `fg` and the palette
// passes AAA again.
//
// The footer sits deeper (4.4:1) so the page resolves onto something more
// solid than it started.

export type PaletteName =
  | "hero"
  | "about"
  | "work"
  | "curatorial"
  | "contact";

export interface Pair {
  bg: string;
  fg: string;
  tints: [string, string, string, string];
}

export const palette: Record<PaletteName, Pair> = {
  hero: {
    bg: "#8fb0b5",
    fg: "#ffffff", // 2.32:1 — dark alternative #16211f is 7.11:1
    tints: ["#a9acb4", "#8b98ab", "#7a9fa8", "#a09b9e"],
  },
  about: {
    bg: "#c2ae99",
    fg: "#ffffff", // 2.14:1 — dark alternative #1f1a14 is 8.07:1
    tints: ["#c3aba6", "#a4979d", "#939e9a", "#b99a90"],
  },
  work: {
    bg: "#bd9ea3",
    fg: "#ffffff", // 2.45:1 — dark alternative #1f1416 is 7.34:1
    tints: ["#c0a3ab", "#a28fa2", "#91969f", "#b79295"],
  },
  curatorial: {
    bg: "#a3b189",
    fg: "#ffffff", // 2.28:1 — dark alternative #1a1f14 is 7.37:1
    tints: ["#b3ac9e", "#959895", "#849f92", "#aa9b88"],
  },
  contact: {
    bg: "#5f7d82",
    fg: "#ffffff", // 4.43:1
    tints: ["#91929a", "#737e92", "#62858e", "#888185"],
  },
};

export const DEFAULT_PALETTE: PaletteName = "hero";

/** Attributes for a <section>, spread straight onto the element. */
export function paletteAttrs(name: PaletteName) {
  const { bg, fg, tints } = palette[name];
  return {
    "data-bg": bg,
    "data-fg": fg,
    "data-tints": tints.join(","),
  };
}

/** The inline style that colours the first paint, avoiding a white flash. */
export function paletteStyle(name: PaletteName): string {
  const { bg, fg, tints } = palette[name];
  return [
    `--bg:${bg}`,
    `--fg:${fg}`,
    ...tints.map((t, i) => `--t${i + 1}:${t}`),
  ].join(";");
}
