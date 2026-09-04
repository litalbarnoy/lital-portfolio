// The scroll-driven palette. Sections carry a named pair; the layout writes
// it out as the data-* attributes the observer reads, so a hex is only ever
// written down here.
//
// Each pair is a background, a foreground, and four tints. The tints are the
// colours of the drifting gradient field behind the page — they are the
// reference site's own accents (#c3a7b2, #867fa1, #648d9a, #b08587) pulled
// 70% of the way toward the pair's background.
//
// That 70% is a contrast budget, not a taste call. Text sits over a moving
// mesh, so the readable-contrast question is not "fg against bg" but "fg
// against the worst point of the field". At this strength the worst tint in
// the worst pair still clears 7:1 (7.44:1); pushing the tints any further
// from the background starts to fail it.

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
    bg: "#acc5c9",
    fg: "#16211f", // 9.11:1 flat, 7.44:1 worst tint
    tints: ["#b3bcc2", "#a1b0bd", "#96b4bb", "#adb2b5"],
  },
  about: {
    bg: "#efe6da",
    fg: "#1a1a1a", // 14.09:1 flat, 10.50:1 worst tint
    tints: ["#e2d3ce", "#cfc7c9", "#c5cbc7", "#dcc9c1"],
  },
  work: {
    bg: "#d8c3c6",
    fg: "#1f1416", // 10.72:1 flat, 8.60:1 worst tint
    tints: ["#d2bbc0", "#bfafbb", "#b5b3b9", "#ccb0b3"],
  },
  curatorial: {
    bg: "#c6cfb2",
    fg: "#1a1f14", // 10.38:1 flat, 8.23:1 worst tint
    tints: ["#c5c3b2", "#b3b7ad", "#a9bbab", "#bfb9a5"],
  },
  contact: {
    bg: "#1a1a1a",
    fg: "#efe6da", // 14.09:1 flat, 7.60:1 worst tint
    tints: ["#4d4448", "#3a3843", "#303d40", "#473a3b"],
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
