import { Router } from "express";
import { db } from "@workspace/db";
import { ordersTable, cartItemsTable, productsTable, couponsTable } from "@workspace/db";
import { eq, desc, and, sql } from "drizzle-orm";

/* ── Secure Order Number ── */
let _orderNumberColReady = false;
async function ensureOrderNumberColumn() {
  if (_orderNumberColReady) return;
  await db.execute(sql`ALTER TABLE orders ADD COLUMN IF NOT EXISTS order_number TEXT UNIQUE`);
  _orderNumberColReady = true;
}

function generateOrderNumber(): string {
  const now = new Date();
  const date = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}`;
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let rand = "";
  for (let i = 0; i < 6; i++) rand += chars[Math.floor(Math.random() * chars.length)];
  return `PRL-${date}-${rand}`;
}

async function deductStockAndLog(items: Array<{ productId: number; quantity: number }>, orderId: number) {
  try {
    for (const item of items) {
      const [p] = await db.select({ stock: productsTable.stock }).from(productsTable).where(eq(productsTable.id, item.productId));
      if (!p) continue;
      const oldStock = p.stock;
      const newStock = Math.max(0, oldStock - item.quantity);
      await db.update(productsTable).set({ stock: newStock }).where(eq(productsTable.id, item.productId));
      await db.execute(sql`
        INSERT INTO stock_history (product_id, previous_stock, new_stock, change, reason, order_id, note)
        VALUES (${item.productId}, ${oldStock}, ${newStock}, ${newStock - oldStock}, 'order_placed', ${orderId}, ${"Order #" + orderId + " — qty " + item.quantity})
      `);
    }
  } catch {}
}
import { requireAuth, optionalAuth, getSessionId, requireAdmin } from "../lib/auth";
import { sendOrderConfirmationEmail, sendOrderStatusEmail, sendReturnRequestStatusEmail } from "../lib/mailgun";
import { isEmailEnabled } from "../lib/emailSettings";

/* ── Return Requests table (auto-created on first use) ── */
let _returnTableReady = false;
async function ensureReturnTable() {
  if (_returnTableReady) return;
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS return_requests (
      id SERIAL PRIMARY KEY,
      order_id INTEGER NOT NULL,
      user_id INTEGER,
      customer_name TEXT,
      customer_email TEXT,
      reason TEXT NOT NULL,
      description TEXT,
      status TEXT DEFAULT 'pending' NOT NULL,
      admin_note TEXT,
      created_at TIMESTAMP DEFAULT NOW() NOT NULL,
      updated_at TIMESTAMP DEFAULT NOW() NOT NULL
    )
  `);
  _returnTableReady = true;
}

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
    orderNumber: o.order_number || o.orderNumber || null,
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
    // Security: unauthenticated requests must not see any orders
    if (!user) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }
    const { status, page = 1, limit = 10 } = req.query;
    const offset = (Number(page) - 1) * Number(limit);
    const conditions: any[] = [];

    if (user.role !== "admin") {
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

    await ensureOrderNumberColumn();
    const orderNumber = generateOrderNumber();

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

    // Assign the secure order number
    await db.execute(sql`UPDATE orders SET order_number = ${orderNumber} WHERE id = ${order.id}`);
    (order as any).order_number = orderNumber;

    await db.delete(cartItemsTable).where(eq(cartItemsTable.sessionId, sessionId));

    const orderData = toOrder(order);
    res.status(201).json(orderData);

    // Deduct stock for each item (fire-and-forget)
    deductStockAndLog(items.map(i => ({ productId: i.productId, quantity: i.quantity })), order.id).catch(() => {});

    // Fire-and-forget — do not await so the response is not delayed
    if (orderData.customerEmail) {
      isEmailEnabled("orderConfirmation").then(enabled => {
        if (enabled) sendOrderConfirmationEmail(orderData as any, APP_URL).catch(e => console.error("Order confirmation email failed:", e));
      });
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
      isEmailEnabled("orderStatusUpdate").then(enabled => {
        if (enabled) sendOrderStatusEmail(
          orderData.customerEmail!,
          orderData.customerName || "Valued Customer",
          orderData.id,
          status,
          APP_URL,
        ).catch(e => console.error("Order status email failed:", e));
      });
    }
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Failed to update order" });
  }
});

/* ── Return Requests ── */

// User submits a return/refund request for a delivered order
router.post("/orders/:id/return-request", requireAuth, async (req, res) => {
  try {
    await ensureReturnTable();
    const orderId = parseInt(req.params.id);
    const user = (req as any).user;
    const { reason, description } = req.body;
    if (!reason) { res.status(400).json({ error: "Reason is required" }); return; }

    // Verify order belongs to this user and is delivered
    const [order] = await db.select().from(ordersTable).where(eq(ordersTable.id, orderId));
    if (!order) { res.status(404).json({ error: "Order not found" }); return; }
    if (user.role !== "admin" && order.userId !== user.id) {
      res.status(403).json({ error: "Forbidden" }); return;
    }
    if (order.status !== "delivered") {
      res.status(400).json({ error: "Only delivered orders can be returned" }); return;
    }

    // Check for existing pending request
    const existing = await db.execute(sql`
      SELECT id FROM return_requests WHERE order_id = ${orderId} AND status = 'pending'
    `);
    if ((existing as any).rows?.length > 0) {
      res.status(400).json({ error: "A return request is already pending for this order" }); return;
    }

    await db.execute(sql`
      INSERT INTO return_requests (order_id, user_id, customer_name, customer_email, reason, description)
      VALUES (${orderId}, ${user.id}, ${order.customerName}, ${order.customerEmail}, ${reason}, ${description || null})
    `);

    res.status(201).json({ message: "Return request submitted successfully" });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Failed to submit return request" });
  }
});

// Admin: list all return requests
router.get("/admin/return-requests", requireAdmin, async (req, res) => {
  try {
    await ensureReturnTable();
    const { status } = req.query;
    let query = `SELECT * FROM return_requests`;
    if (status && status !== "all") query += ` WHERE status = '${status}'`;
    query += ` ORDER BY created_at DESC`;
    const result = await db.execute(sql.raw(query));
    const rows = (result as any).rows ?? [];
    res.json(rows);
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Failed to fetch return requests" });
  }
});

// Admin: update return request status / note
router.patch("/admin/return-requests/:id", requireAdmin, async (req, res) => {
  try {
    await ensureReturnTable();
    const id = parseInt(req.params.id);
    const { status, adminNote } = req.body;
    await db.execute(sql`
      UPDATE return_requests
      SET status = ${status}, admin_note = ${adminNote ?? null}, updated_at = NOW()
      WHERE id = ${id}
    `);

    // Send status email to customer for approved / rejected decisions
    if (status === "approved" || status === "rejected") {
      const result = await db.execute(sql`
        SELECT customer_email, customer_name, order_id FROM return_requests WHERE id = ${id} LIMIT 1
      `);
      const row = result.rows?.[0] as { customer_email: string; customer_name: string; order_id: number } | undefined;
      if (row?.customer_email) {
        isEmailEnabled("returnStatusUpdate").then(enabled => {
          if (enabled) sendReturnRequestStatusEmail(
            row.customer_email,
            row.customer_name ?? "Valued Customer",
            row.order_id,
            status,
            adminNote ?? null,
            APP_URL,
          ).catch(err => console.error("Return status email error:", err));
        });
      }
    }

    res.json({ message: "Updated" });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Failed to update return request" });
  }
});

export default router;

