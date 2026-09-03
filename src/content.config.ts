import { defineCollection, z } from "astro:content";
import { glob } from "astro/loaders";

const projectSchema = z.object({
  title: z.string(),
  subtitle: z.string(),
  role: z.string(),
  client: z.string(),
  year: z.number(),
  tags: z.array(z.string()),
  cover: z.string(),
  gallery: z.array(z.string()),
  video: z.string().optional(),
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
  tags: z.array(z.string()).default([]),
  cover: z.string().optional(),
  gallery: z.array(z.string()).default([]),
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
