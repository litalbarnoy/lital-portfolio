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

export const collections = {
  "product-design": productDesign,
  curatorial: curatorial,
};
