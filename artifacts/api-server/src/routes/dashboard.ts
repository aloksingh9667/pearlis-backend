import { Router } from "express";
import { db } from "@workspace/db";
import { ordersTable, productsTable, usersTable } from "@workspace/db";
import { eq, desc, sql, gte } from "drizzle-orm";
import { requireAdmin } from "../lib/auth";

const router = Router();

router.get("/dashboard/stats", requireAdmin, async (req, res) => {
  try {
    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);

    const [
      ordersResult, productsResult, usersResult,
      pendingResult, revenueResult, monthOrdersResult, monthUsersResult,
    ] = await Promise.all([
      db.select({ count: sql<number>`count(*)`, total: sql<number>`sum(total)` }).from(ordersTable),
      db.select({ count: sql<number>`count(*)` }).from(productsTable),
      db.select({ count: sql<number>`count(*)` }).from(usersTable),
      db.select({ count: sql<number>`count(*)` }).from(ordersTable).where(eq(ordersTable.status, "pending")),
      db.select({ total: sql<number>`sum(total)` }).from(ordersTable).where(gte(ordersTable.createdAt, startOfMonth)),
      db.select({ count: sql<number>`count(*)` }).from(ordersTable).where(gte(ordersTable.createdAt, startOfMonth)),
      db.select({ count: sql<number>`count(*)` }).from(usersTable).where(gte(usersTable.createdAt, startOfMonth)),
    ]);

    res.json({
      totalRevenue: parseFloat(String(ordersResult[0]?.total || 0)),
      totalOrders: Number(ordersResult[0]?.count || 0),
      totalProducts: Number(productsResult[0]?.count || 0),
      totalUsers: Number(usersResult[0]?.count || 0),
      pendingOrders: Number(pendingResult[0]?.count || 0),
      revenueThisMonth: parseFloat(String(revenueResult[0]?.total || 0)),
      ordersThisMonth: Number(monthOrdersResult[0]?.count || 0),
      newUsersThisMonth: Number(monthUsersResult[0]?.count || 0),
    });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Failed to get stats" });
  }
});

router.get("/dashboard/recent-orders", requireAdmin, async (req, res) => {
  try {
    const limit = parseInt(req.query.limit as string || "5");
    const orders = await db.select().from(ordersTable).orderBy(desc(ordersTable.createdAt)).limit(limit);
    res.json(orders.map((o) => ({
      id: o.id, userId: o.userId, status: o.status,
      total: parseFloat(o.total), subtotal: parseFloat(o.subtotal),
      discount: parseFloat(o.discount || "0"), couponCode: o.couponCode,
      items: o.items, shippingAddress: o.shippingAddress,
      paymentMethod: o.paymentMethod, paymentStatus: o.paymentStatus,
      customerName: o.customerName, customerEmail: o.customerEmail,
      createdAt: o.createdAt?.toISOString(),
    })));
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Failed" });
  }
});

router.get("/dashboard/top-products", requireAdmin, async (req, res) => {
  try {
    const limit = parseInt(req.query.limit as string || "5");
    const products = await db.select().from(productsTable).orderBy(desc(productsTable.reviewCount)).limit(limit);
    res.json(products.map((p) => ({
      id: p.id, name: p.name, slug: p.slug, description: p.description,
      price: parseFloat(p.price),
      discountPrice: p.discountPrice ? parseFloat(p.discountPrice) : null,
      category: p.category, categoryId: p.categoryId, material: p.material,
      images: p.images || [], stock: p.stock, isNew: p.isNew, isTrending: p.isTrending,
      isFeatured: p.isFeatured, rating: parseFloat(p.rating || "0"),
      reviewCount: p.reviewCount, tags: p.tags || [], createdAt: p.createdAt?.toISOString(),
    })));
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Failed" });
  }
});

router.get("/dashboard/sales-by-category", requireAdmin, async (req, res) => {
  try {
    const orders = await db.select().from(ordersTable);
    const categoryMap = new Map<string, { totalSales: number; totalRevenue: number }>();

    for (const order of orders) {
      const items = (order.items as any[]) || [];
      for (const item of items) {
        const cat = item.category || "Uncategorized";
        const existing = categoryMap.get(cat) || { totalSales: 0, totalRevenue: 0 };
        categoryMap.set(cat, {
          totalSales: existing.totalSales + item.quantity,
          totalRevenue: existing.totalRevenue + item.price * item.quantity,
        });
      }
    }

    const result = Array.from(categoryMap.entries()).map(([category, data]) => ({
      category,
      totalSales: data.totalSales,
      totalRevenue: data.totalRevenue,
    }));

    res.json(result);
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Failed" });
  }
});

export default router;
