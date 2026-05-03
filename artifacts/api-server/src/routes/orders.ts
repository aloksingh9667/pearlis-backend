import { Router } from "express";
import { db } from "@workspace/db";
import { ordersTable, cartItemsTable, productsTable, couponsTable } from "@workspace/db";
import { eq, desc, and, sql } from "drizzle-orm";
import { requireAuth, optionalAuth, getSessionId, requireAdmin } from "../lib/auth";
import { sendOrderConfirmationEmail, sendOrderStatusEmail } from "../lib/mailgun";

const APP_URL = process.env.APP_URL || "https://pearlis.replit.app";

const router = Router();


function safeArr(v: any): any[] {
  if (Array.isArray(v)) return v;
  if (typeof v === 'string') { try { const p = JSON.parse(v); return Array.isArray(p) ? p : []; } catch { return []; } }
  return [];
}
function toOrder(o: any) {
  return {
    id: o.id,
    userId: o.userId,
    status: o.status,
    total: parseFloat(o.total),
    subtotal: parseFloat(o.subtotal),
    discount: parseFloat(o.discount || "0"),
    couponCode: o.couponCode,
    items: safeArr(o.items),
    shippingAddress: o.shippingAddress,
    paymentMethod: o.paymentMethod,
    paymentStatus: o.paymentStatus,
    customerName: o.customerName,
    customerEmail: o.customerEmail,
    createdAt: o.createdAt?.toISOString(),
  };
}

router.use(optionalAuth);

router.get("/orders", async (req, res) => {
  try {
    const user = (req as any).user;
    const { status, page = 1, limit = 10 } = req.query;
    const offset = (Number(page) - 1) * Number(limit);
    const conditions: any[] = [];

    if (user?.role !== "admin" && user) {
      conditions.push(eq(ordersTable.userId, user.id));
    }
    if (status) conditions.push(eq(ordersTable.status, status as any));

    const where = conditions.length > 0 ? and(...conditions) : undefined;
    const [orders, countResult] = await Promise.all([
      db.select().from(ordersTable).where(where).orderBy(desc(ordersTable.createdAt)).limit(Number(limit)).offset(offset),
      db.select({ count: sql<number>`count(*)` }).from(ordersTable).where(where),
    ]);

    res.json({
      orders: orders.map(toOrder),
      total: Number(countResult[0]?.count || 0),
      page: Number(page),
      limit: Number(limit),
    });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Failed to list orders" });
  }
});

router.post("/orders", async (req, res) => {
  try {
    const user = (req as any).user;
    const sessionId = getSessionId(req);
    const { shippingAddress, paymentMethod, couponCode } = req.body;

    const cartItems = await db.select().from(cartItemsTable).where(eq(cartItemsTable.sessionId, sessionId));
    if (cartItems.length === 0) {
      res.status(400).json({ error: "Cart is empty" });
      return;
    }

    const productIds = cartItems.map((i) => i.productId);
    const products = await db.select().from(productsTable);
    const productMap = new Map(products.map((p) => [p.id, p]));

    const items = cartItems.map((item) => {
      const product = productMap.get(item.productId);
      if (!product) return null;
      const price = product.discountPrice ? parseFloat(product.discountPrice) : parseFloat(product.price);
      return {
        productId: item.productId,
        quantity: item.quantity,
        price,
        productName: product.name,
        productImage: (product.images as string[])?.[0] || "",
      };
    }).filter(Boolean) as any[];

    const subtotal = items.reduce((sum, item) => sum + item.price * item.quantity, 0);
    let discount = 0;

    if (couponCode) {
      const [coupon] = await db.select().from(couponsTable).where(eq(couponsTable.code, couponCode.toUpperCase()));
      if (coupon && coupon.isActive) {
        if (coupon.discountType === "percentage") {
          discount = subtotal * parseFloat(coupon.discountValue) / 100;
        } else {
          discount = parseFloat(coupon.discountValue);
        }
        await db.update(couponsTable).set({ usedCount: coupon.usedCount + 1 }).where(eq(couponsTable.id, coupon.id));
      }
    }

    const total = Math.max(0, subtotal - discount);

    const [order] = await db.insert(ordersTable).values({
      userId: user?.id,
      status: "pending",
      total: total.toString(),
      subtotal: subtotal.toString(),
      discount: discount.toString(),
      couponCode: couponCode || null,
      items,
      shippingAddress,
      paymentMethod: paymentMethod || "cod",
      paymentStatus: "pending",
      customerName: user?.name || shippingAddress?.name,
      customerEmail: user?.email,
    }).returning();

    await db.delete(cartItemsTable).where(eq(cartItemsTable.sessionId, sessionId));

    const orderData = toOrder(order);
    res.status(201).json(orderData);

    // Fire-and-forget — do not await so the response is not delayed
    if (orderData.customerEmail) {
      sendOrderConfirmationEmail(orderData as any, APP_URL).catch((e) =>
        console.error("Order confirmation email failed:", e)
      );
    }
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Failed to create order" });
  }
});

router.get("/orders/:id", async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const [order] = await db.select().from(ordersTable).where(eq(ordersTable.id, id));
    if (!order) { res.status(404).json({ error: "Not found" }); return; }
    res.json(toOrder(order));
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Failed" });
  }
});

router.put("/orders/:id", requireAdmin, async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const { status } = req.body;
    const [order] = await db.update(ordersTable).set({ status }).where(eq(ordersTable.id, id)).returning();
    if (!order) { res.status(404).json({ error: "Not found" }); return; }
    const orderData = toOrder(order);
    res.json(orderData);

    // Notify customer of status change (fire-and-forget)
    if (orderData.customerEmail && ["confirmed", "shipped", "delivered", "cancelled"].includes(status)) {
      sendOrderStatusEmail(
        orderData.customerEmail,
        orderData.customerName || "Valued Customer",
        orderData.id,
        status,
        APP_URL,
      ).catch((e) => console.error("Order status email failed:", e));
    }
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Failed to update order" });
  }
});

export default router;
