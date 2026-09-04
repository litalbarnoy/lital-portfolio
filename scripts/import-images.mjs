// Turns dropped photos into web-ready images, so nothing has to be resized
// or renamed by hand.
//
//   ~/Desktop/site-images/<project>/anything.png  ->  public/images/imports/<project>/01.webp
//
// A file whose name starts with "cover" becomes the cover; everything else is
// numbered in filename order. Existing images in a project folder are left
// alone and new ones continue the numbering.
//
// Run with: npm run images

import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import sharp from "sharp";

const DROP = path.join(os.homedir(), "Desktop", "site-images");
const DEST = path.join(process.cwd(), "public", "images", "imports");
const UPLOADS = path.join(process.cwd(), "public", "images", "uploads");

const MAX_WIDTH = 1800;
const QUALITY = 80;
const SOURCE_TYPES = /\.(png|jpe?g|webp|tiff?|heic|avif)$/i;

const kb = (bytes) => `${Math.round(bytes / 1024)}kb`;

async function exists(p) {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

async function convert(from, to) {
  await sharp(from)
    .rotate() // honour EXIF orientation, or phone photos land sideways
    .resize({ width: MAX_WIDTH, withoutEnlargement: true })
    .webp({ quality: QUALITY })
    .toFile(to);

  const [before, after] = await Promise.all([fs.stat(from), fs.stat(to)]);
  const meta = await sharp(to).metadata();
  return { before: before.size, after: after.size, w: meta.width, h: meta.height };
}

async function importProject(slug) {
  const from = path.join(DROP, slug);
  const to = path.join(DEST, slug);
  await fs.mkdir(to, { recursive: true });

  const dropped = (await fs.readdir(from))
    .filter((f) => SOURCE_TYPES.test(f))
    .sort();
  if (!dropped.length) return null;

  // Continue after whatever is already in the project folder.
  const taken = (await fs.readdir(to)).filter((f) => /^\d+\.webp$/.test(f));
  let next = taken.length
    ? Math.max(...taken.map((f) => parseInt(f, 10))) + 1
    : 1;

  const done = [];
  for (const file of dropped) {
    const isCover = /^cover/i.test(file);
    const name = isCover ? "cover.webp" : `${String(next++).padStart(2, "0")}.webp`;
    const stats = await convert(path.join(from, file), path.join(to, name));
    done.push({ file, name, ...stats });
  }
  return done;
}

// CMS uploads arrive at full camera resolution. Shrink in place, keeping the
// filename and format so nothing that already points at them breaks.
async function shrinkUploads() {
  if (!(await exists(UPLOADS))) return [];
  const files = (await fs.readdir(UPLOADS)).filter((f) => SOURCE_TYPES.test(f));
  const done = [];

  for (const file of files) {
    const full = path.join(UPLOADS, file);
    const before = (await fs.stat(full)).size;
    const meta = await sharp(full).metadata();
    if (before < 400 * 1024 && (meta.width ?? 0) <= MAX_WIDTH) continue;

    const tmp = `${full}.tmp`;
    const pipeline = sharp(full)
      .rotate()
      .resize({ width: MAX_WIDTH, withoutEnlargement: true });
    const ext = path.extname(file).toLowerCase();
    if (ext === ".png") await pipeline.png({ compressionLevel: 9 }).toFile(tmp);
    else if (ext === ".webp") await pipeline.webp({ quality: QUALITY }).toFile(tmp);
    else await pipeline.jpeg({ quality: 82 }).toFile(tmp);

    const after = (await fs.stat(tmp)).size;
    if (after < before) {
      await fs.rename(tmp, full);
      done.push({ file, before, after });
    } else {
      await fs.unlink(tmp);
    }
  }
  return done;
}

async function main() {
  await fs.mkdir(DROP, { recursive: true });

  const entries = await fs.readdir(DROP, { withFileTypes: true });
  const projects = entries.filter((e) => e.isDirectory()).map((e) => e.name);

  if (!projects.length) {
    console.log(`אין תיקיות ב-${DROP}`);
    console.log("צרי שם תיקייה בשם הפרויקט, גררי לתוכה תמונות, והריצי שוב.");
  }

  for (const slug of projects) {
    const done = await importProject(slug);
    if (!done) {
      console.log(`${slug}: אין תמונות`);
      continue;
    }
    console.log(`\n${slug} → public/images/imports/${slug}/`);
    for (const d of done) {
      console.log(`  ${d.file}\n    → ${d.name}  ${d.w}x${d.h}  ${kb(d.before)} → ${kb(d.after)}`);
    }
    console.log(`  הנתיבים לקובץ התוכן:`);
    for (const d of done) console.log(`    /images/imports/${slug}/${d.name}`);
  }

  const shrunk = await shrinkUploads();
  if (shrunk.length) {
    console.log(`\nכווצתי ${shrunk.length} העלאות מה-CMS:`);
    for (const s of shrunk) console.log(`  ${s.file}  ${kb(s.before)} → ${kb(s.after)}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
