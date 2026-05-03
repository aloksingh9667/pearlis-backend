import { pgTable, serial, text, numeric, integer, boolean, timestamp, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const categoriesTable = pgTable("categories", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  imageUrl: text("image_url"),
  description: text("description"),
  productCount: integer("product_count").default(0).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const productsTable = pgTable("products", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  description: text("description"),
  price: numeric("price", { precision: 10, scale: 2 }).notNull(),
  discountPrice: numeric("discount_price", { precision: 10, scale: 2 }),
  categoryId: integer("category_id").references(() => categoriesTable.id),
  category: text("category").notNull(),
  material: text("material"),
  images: jsonb("images").$type<string[]>().default([]).notNull(),
  videoUrl: text("video_url"),
  stock: integer("stock").default(0).notNull(),
  isNew: boolean("is_new").default(false).notNull(),
  isTrending: boolean("is_trending").default(false).notNull(),
  isFeatured: boolean("is_featured").default(false).notNull(),
  rating: numeric("rating", { precision: 3, scale: 2 }).default("0").notNull(),
  reviewCount: integer("review_count").default(0).notNull(),
  tags: jsonb("tags").$type<string[]>().default([]).notNull(),
  specifications: jsonb("specifications").$type<Array<{key: string; value: string}>>().default([]),
  craftStory: text("craft_story"),
  craftPoints: jsonb("craft_points").$type<string[]>().default([]),
  shippingInfo: text("shipping_info"),
  sizes: jsonb("sizes").$type<string[]>().default([]).notNull(),
  materialVariants: jsonb("material_variants").$type<Array<{name: string; productId?: number | null}>>().default([]).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertProductSchema = createInsertSchema(productsTable).omit({ id: true, createdAt: true });
export const insertCategorySchema = createInsertSchema(categoriesTable).omit({ id: true, createdAt: true });

export type Product = typeof productsTable.$inferSelect;
export type InsertProduct = z.infer<typeof insertProductSchema>;
export type Category = typeof categoriesTable.$inferSelect;
export type InsertCategory = z.infer<typeof insertCategorySchema>;
