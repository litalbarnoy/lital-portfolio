import { defineCollection, z } from "astro:content";
import { glob } from "astro/loaders";

// A gallery item is either a plain path or a path with a caption. Keeping
// the bare string valid means existing content files stay correct, and the
// caption doubles as the image's alt text — crediting an artist and
// describing the image are the same sentence here.
const mediaItem = z.union([
  z.string(),
  z.object({
    src: z.string(),
    caption: z.string().optional(),
    alt: z.string().optional(),
  }),
]);

const projectSchema = z.object({
  title: z.string(),
  subtitle: z.string(),
  role: z.string(),
  client: z.string(),
  year: z.number(),
  yearEnd: z.number().optional(),
  ongoing: z.boolean().optional(),
  tags: z.array(z.string()),
  cover: z.string(),
  gallery: z.array(mediaItem),
  video: z.string().optional(),
  // Vector UI animations shown alongside the stills.
  animations: z
    .array(
      z.object({
        src: z.string(),
        caption: z.string().optional(),
        width: z.number(),
        height: z.number(),
      })
    )
    .optional(),
  externalUrl: z.string().optional(),
  order: z.number(),
});

const productDesign = defineCollection({
  loader: glob({ pattern: "**/*.md", base: "./src/content/product-design" }),
  schema: projectSchema,
});

const curatorial = defineCollection({
  loader: glob({ pattern: "**/*.md", base: "./src/content/curatorial" }),
  schema: projectSchema,
});

const academicSchema = z.object({
  title: z.string(),
  subtitle: z.string(),
  role: z.string(),
  client: z.string(),
  year: z.number(),
  yearEnd: z.number().optional(),
  ongoing: z.boolean().optional(),
  tags: z.array(z.string()).default([]),
  cover: z.string().optional(),
  gallery: z.array(mediaItem).default([]),
  video: z.string().optional(),
  externalUrl: z.string().optional(),
  order: z.number(),
});

const academic = defineCollection({
  loader: glob({ pattern: "**/*.md", base: "./src/content/academic" }),
  schema: academicSchema,
});

export const collections = {
  "product-design": productDesign,
  curatorial: curatorial,
  academic: academic,
};
