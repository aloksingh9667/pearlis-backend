import { pgTable, serial, integer, text, numeric, timestamp, boolean, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { productsTable } from "./products";
import { usersTable } from "./users";

export const reviewsTable = pgTable("reviews", {
  id: serial("id").primaryKey(),
  productId: integer("product_id").references(() => productsTable.id).notNull(),
  userId: integer("user_id").references(() => usersTable.id),
  userName: text("user_name").notNull(),
  rating: integer("rating").notNull(),
  comment: text("comment").notNull(),
  isApproved: boolean("is_approved").default(true).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const stockAlertsTable = pgTable("stock_alerts", {
  id: serial("id").primaryKey(),
  productId: integer("product_id").references(() => productsTable.id).notNull(),
  email: text("email").notNull(),
  notifiedAt: timestamp("notified_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const wishlistTable = pgTable("wishlist", {
  id: serial("id").primaryKey(),
  sessionId: text("session_id").notNull(),
  productId: integer("product_id").references(() => productsTable.id).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const blogsTable = pgTable("blogs", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  slug: text("slug").notNull().unique(),
  excerpt: text("excerpt").notNull(),
  content: text("content").notNull(),
  imageUrl: text("image_url").notNull(),
  author: text("author").notNull(),
  tags: jsonb("tags").$type<string[]>().default([]).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const couponsTable = pgTable("coupons", {
  id: serial("id").primaryKey(),
  code: text("code").notNull().unique(),
  discountType: text("discount_type", { enum: ["percentage", "fixed"] }).notNull(),
  discountValue: numeric("discount_value", { precision: 10, scale: 2 }).notNull(),
  minOrderAmount: numeric("min_order_amount", { precision: 10, scale: 2 }),
  maxUses: integer("max_uses"),
  usedCount: integer("used_count").default(0).notNull(),
  isActive: boolean("is_active").default(true).notNull(),
  expiresAt: timestamp("expires_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const newsletterTable = pgTable("newsletter", {
  id: serial("id").primaryKey(),
  email: text("email").notNull().unique(),
  subscribedAt: timestamp("subscribed_at").defaultNow().notNull(),
});

// Site-wide settings stored as key-value pairs with JSONB values
export const siteSettingsTable = pgTable("site_settings", {
  id: serial("id").primaryKey(),
  key: text("key").notNull().unique(),
  value: jsonb("value").notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// Per-page content management
export const pageContentTable = pgTable("page_content", {
  id: serial("id").primaryKey(),
  page: text("page").notNull().unique(),
  content: jsonb("content").notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// Contact form messages
export const contactMessagesTable = pgTable("contact_messages", {
  id: serial("id").primaryKey(),
  firstName: text("first_name").notNull(),
  lastName: text("last_name").notNull(),
  email: text("email").notNull(),
  subject: text("subject").notNull(),
  message: text("message").notNull(),
  isRead: boolean("is_read").default(false).notNull(),
  replied: boolean("replied").default(false).notNull(),
  repliedAt: timestamp("replied_at"),
  adminReply: text("admin_reply"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const videosTable = pgTable("videos", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  description: text("description"),
  videoUrl: text("video_url").notNull(),
  thumbnailUrl: text("thumbnail_url"),
  category: text("category").default("lookbook"),
  isFeatured: boolean("is_featured").default(false).notNull(),
  isPublished: boolean("is_published").default(true).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type Review = typeof reviewsTable.$inferSelect;
export type Blog = typeof blogsTable.$inferSelect;
export type Coupon = typeof couponsTable.$inferSelect;
export type SiteSetting = typeof siteSettingsTable.$inferSelect;
export type PageContent = typeof pageContentTable.$inferSelect;
export type ContactMessage = typeof contactMessagesTable.$inferSelect;
export type Video = typeof videosTable.$inferSelect;
