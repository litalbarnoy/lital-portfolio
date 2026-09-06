// Maps the existing project markdown onto the sectioned layout without
// asking every content file to be rewritten. Bodies use exactly four
// constructs — `## ` headings, `- ` bullets, `**bold**` and `*italic*` — so
// they are rendered here directly rather than pulling in a markdown
// dependency. Anything outside that set is escaped and shown verbatim,
// never executed.

export interface TextSection {
  label: string;
  html: string;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function inline(value: string): string {
  return (
    escapeHtml(value)
      .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
      // Bold is consumed first, so nothing here can see a `**` pair. Several
      // pages already used this for their closing credit line and were
      // printing the asterisks on screen.
      .replace(/\*([^*\n]+)\*/g, "<em>$1</em>")
  );
}

// Groups a chunk's lines into paragraphs and bullet lists.
function renderBlocks(lines: string[]): string {
  const out: string[] = [];
  let paragraph: string[] = [];
  let bullets: string[] = [];

  const flushParagraph = () => {
    if (!paragraph.length) return;
    out.push(`<p>${inline(paragraph.join(" "))}</p>`);
    paragraph = [];
  };
  const flushBullets = () => {
    if (!bullets.length) return;
    out.push(`<ul>${bullets.map((b) => `<li>${inline(b)}</li>`).join("")}</ul>`);
    bullets = [];
  };

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) {
      flushParagraph();
      flushBullets();
      continue;
    }
    if (/^-\s+/.test(line)) {
      flushParagraph();
      bullets.push(line.replace(/^-\s+/, ""));
      continue;
    }
    flushBullets();
    paragraph.push(line);
  }
  flushParagraph();
  flushBullets();

  return out.join("");
}

/** Splits a project body into one section per `## ` heading. */
export function parseSections(body: string): TextSection[] {
  const lines = body.split(/\r?\n/);
  const sections: TextSection[] = [];
  let label = "";
  let buffer: string[] = [];

  const flush = () => {
    if (!label && !buffer.some((l) => l.trim())) return;
    sections.push({ label, html: renderBlocks(buffer) });
    buffer = [];
  };

  for (const line of lines) {
    const heading = line.match(/^##\s+(.*)$/);
    if (heading) {
      flush();
      label = heading[1].trim();
      continue;
    }
    buffer.push(line);
  }
  flush();

  return sections.filter((s) => s.label || s.html);
}

export type Block =
  | ({ type: "text" } & TextSection)
  | { type: "media"; layout: "wide" | "pair"; items: string[] }
  | { type: "video"; url: string }
  | { type: "gallery"; items: string[] };

/**
 * Interleaves the parsed text sections with the project's images so the page
 * alternates reading and looking, per the section order in the layout spec.
 * The cover is deliberately absent — it appears once, full-bleed, and is
 * never repeated further down.
 */
export function buildBlocks(
  body: string,
  gallery: string[],
  video?: string
): Block[] {
  const texts = parseSections(body);
  const queue = [...gallery];
  const blocks: Block[] = [];

  texts.forEach((section, i) => {
    blocks.push({ type: "text", ...section });

    if (i === 0 && queue.length) {
      blocks.push({ type: "media", layout: "wide", items: [queue.shift()!] });
    } else if (i === 1 && queue.length >= 2) {
      blocks.push({
        type: "media",
        layout: "pair",
        items: [queue.shift()!, queue.shift()!],
      });
    }
  });

  if (video) blocks.push({ type: "video", url: video });
  if (queue.length) blocks.push({ type: "gallery", items: queue });

  return blocks;
}
