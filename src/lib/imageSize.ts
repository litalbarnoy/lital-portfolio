// Real intrinsic dimensions for every media item, resolved at build time.
// Every figure needs these: without them the browser has no aspect ratio to
// reserve, lazy images shift the layout after ScrollTrigger has measured,
// and every start/end position downstream is wrong.

import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(import.meta.url);

export interface Size {
  width: number;
  height: number;
}

const FALLBACK: Size = { width: 1200, height: 900 };
const cache = new Map<string, Size>();

function fromPlaceholder(src: string): Size | null {
  // https://placehold.co/1200x900/... — the size is in the path.
  const match = src.match(/placehold\.co\/(\d+)x(\d+)/);
  return match
    ? { width: Number(match[1]), height: Number(match[2]) }
    : null;
}

async function fromDisk(src: string): Promise<Size | null> {
  try {
    // sharp ships with Astro's image pipeline; required lazily so this module
    // stays importable in environments where it is unavailable.
    const sharp = require("sharp");
    const file = path.join(process.cwd(), "public", src.replace(/^\//, ""));
    const { width, height } = await sharp(file).metadata();
    if (width && height) return { width, height };
  } catch {
    /* unreadable or unsupported — fall through to the default ratio */
  }
  return null;
}

/** Intrinsic size of a public-folder path or a remote placeholder URL. */
export async function imageSize(src: string): Promise<Size> {
  const hit = cache.get(src);
  if (hit) return hit;

  const size =
    (src.startsWith("http") ? fromPlaceholder(src) : await fromDisk(src)) ??
    FALLBACK;

  cache.set(src, size);
  return size;
}

/** Resolves several sources at once, preserving order. */
export function imageSizes(sources: string[]): Promise<Size[]> {
  return Promise.all(sources.map(imageSize));
}
