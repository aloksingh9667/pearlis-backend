import { pgTable, serial, integer, text, numeric, timestamp, jsonb, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";

export const ordersTable = pgTable("orders", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").references(() => usersTable.id),
  status: text("status", {
    enum: ["pending", "confirmed", "processing", "shipped", "delivered", "cancelled"],
  }).default("pending").notNull(),
  total: numeric("total", { precision: 10, scale: 2 }).notNull(),
  subtotal: numeric("subtotal", { precision: 10, scale: 2 }).notNull(),
  discount: numeric("discount", { precision: 10, scale: 2 }).default("0").notNull(),
  couponCode: text("coupon_code"),
  items: jsonb("items").$type<Array<{
    productId: number;
    quantity: number;
    price: number;
    productName: string;
    productImage: string;
  }>>().notNull(),
  shippingAddress: jsonb("shipping_address").$type<{
    name: string;
    line1: string;
    line2?: string;
    city: string;
    state: string;
    postalCode: string;
    country: string;
    phone?: string;
  }>().notNull(),
  paymentMethod: text("payment_method").default("cod").notNull(),
  paymentStatus: text("payment_status").default("pending").notNull(),
  customerName: text("customer_name"),
  customerEmail: text("customer_email"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const cartItemsTable = pgTable("cart_items", {
  id: serial("id").primaryKey(),
  sessionId: text("session_id").notNull(),
  productId: integer("product_id").notNull(),
  quantity: integer("quantity").notNull().default(1),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertOrderSchema = createInsertSchema(ordersTable).omit({ id: true, createdAt: true });
export type Order = typeof ordersTable.$inferSelect;
export type InsertOrder = z.infer<typeof insertOrderSchema>;
export type CartItem = typeof cartItemsTable.$inferSelect;
