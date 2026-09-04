// Gallery entries may be written either as a bare path or as a path with a
// caption. Everything downstream works with the resolved shape.

export type MediaEntry = string | { src: string; caption?: string; alt?: string };

export interface Media {
  src: string;
  caption?: string;
  /** Falls back to the caption, then to the project title. */
  alt: string;
}

export function resolveMedia(entry: MediaEntry, fallbackAlt: string): Media {
  if (typeof entry === "string") return { src: entry, alt: fallbackAlt };
  return {
    src: entry.src,
    caption: entry.caption,
    alt: entry.alt ?? entry.caption ?? fallbackAlt,
  };
}

export function resolveGallery(
  entries: MediaEntry[],
  fallbackAlt: string
): Media[] {
  return entries.map((e) => resolveMedia(e, fallbackAlt));
}
