// Normalises any YouTube link into an embeddable one, keeping a start time
// when the link carries one — a lecture link often points at the moment the
// talk actually begins, and dropping that would send viewers to the preamble.

const ID = /(?:youtube\.com\/(?:watch\?v=|embed\/|live\/)|youtu\.be\/)([\w-]{11})/;

function startSeconds(url: string): number | null {
  const match = url.match(/[?&](?:t|start)=(?:(\d+)h)?(?:(\d+)m)?(\d+)s?/);
  if (!match) return null;
  const [, h, m, s] = match;
  const total = Number(h ?? 0) * 3600 + Number(m ?? 0) * 60 + Number(s ?? 0);
  return total > 0 ? total : null;
}

export function youtubeEmbed(url: string): string | null {
  const id = url.match(ID)?.[1];
  if (!id) return null;

  const start = startSeconds(url);
  return `https://www.youtube.com/embed/${id}${start ? `?start=${start}` : ""}`;
}
