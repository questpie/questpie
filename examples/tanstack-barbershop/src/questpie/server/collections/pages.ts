import { uniqueIndex } from "drizzle-orm/pg-core";
import { qb } from "@/questpie/server/builder";

export const pages = qb
  .collection("pages")
  .fields((f) => ({
    title: f.text({ required: true, maxLength: 255, localized: true }),
    slug: f.text({ required: true, maxLength: 255 }),
    description: f.textarea({ localized: true }),
    content: f.blocks({ localized: true }),
    metaTitle: f.text({ maxLength: 255, localized: true }),
    metaDescription: f.textarea({ localized: true }),
    isPublished: f.boolean({ default: false, required: true }),
  }))
  .indexes(({ table }) => [
    uniqueIndex("pages_slug_unique").on(table.slug as any),
  ])
  .title(({ f }) => f.title);
