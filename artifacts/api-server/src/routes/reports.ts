import { Router } from "express";
import { db } from "@workspace/db";
import { ordersTable, usersTable, productsTable, couponsTable } from "@workspace/db";
import { gte, and, sql, desc, eq, isNotNull } from "drizzle-orm";
import { requireAdmin } from "../lib/auth";

const router = Router();

type Period = "7d" | "30d" | "12w" | "12m";

function getPeriodConfig(period: Period) {
  const now = new Date();
  switch (period) {
    case "7d": {
      const start = new Date(now); start.setDate(now.getDate() - 6); start.setHours(0,0,0,0);
      return { start, buckets: 7, unit: "day" as const };
    }
    case "30d": {
      const start = new Date(now); start.setDate(now.getDate() - 29); start.setHours(0,0,0,0);
      return { start, buckets: 30, unit: "day" as const };
    }
    case "12w": {
      const start = new Date(now); start.setDate(now.getDate() - 7 * 11); start.setHours(0,0,0,0);
      return { start, buckets: 12, unit: "week" as const };
    }
    case "12m": {
      const start = new Date(now); start.setMonth(now.getMonth() - 11); start.setDate(1); start.setHours(0,0,0,0);
      return { start, buckets: 12, unit: "month" as const };
    }
  }
}

function buildBuckets(unit: "day" | "week" | "month", buckets: number) {
  const result: string[] = [];
  const now = new Date();
  for (let i = buckets - 1; i >= 0; i--) {
    const d = new Date(now);
    if (unit === "day") {
      d.setDate(d.getDate() - i);
      result.push(d.toISOString().slice(0, 10));
    } else if (unit === "week") {
      d.setDate(d.getDate() - i * 7);
      // Monday of that week
      const day = d.getDay();
      const diff = d.getDate() - day + (day === 0 ? -6 : 1);
      d.setDate(diff);
      result.push(d.toISOString().slice(0, 10));
    } else {
      d.setMonth(d.getMonth() - i);
      d.setDate(1);
      result.push(d.toISOString().slice(0, 7)); // YYYY-MM
    }
  }
  return result;
}

function formatLabel(key: string, unit: "day" | "week" | "month") {
  if (unit === "month") {
    const [y, m] = key.split("-");
    return new Date(parseInt(y), parseInt(m) - 1).toLocaleDateString("en-IN", { month: "short", year: "2-digit" });
  }
  if (unit === "week") {
    const d = new Date(key);
    return d.toLocaleDateString("en-IN", { day: "numeric", month: "short" });
  }
  const d = new Date(key);
  return d.toLocaleDateString("en-IN", { day: "numeric", month: "short" });
}

router.get("/admin/reports", requireAdmin, async (req, res) => {
  try {
    const period = (req.query.period as Period) || "30d";
    const { start, buckets, unit } = getPeriodConfig(period);
    const allBuckets = buildBuckets(unit, buckets);

    // ── Fetch raw orders since start ──
    const orders = await db
      .select()
      .from(ordersTable)
      .where(gte(ordersTable.createdAt, start));

    // ── Fetch new users since start ──
    const users = await db
      .select({ createdAt: usersTable.createdAt })
      .from(usersTable)
      .where(gte(usersTable.createdAt, start));

    // ── Aggregate into buckets ──
    const revenueMap = new Map<string, number>();
    const ordersMap  = new Map<string, number>();
    const usersMap   = new Map<string, number>();

    function getBucket(date: Date): string {
      if (unit === "day")   return date.toISOString().slice(0, 10);
      if (unit === "month") return date.toISOString().slice(0, 7);
      // week: find the Monday
      const day = date.getDay();
      const diff = date.getDate() - day + (day === 0 ? -6 : 1);
      const monday = new Date(date); monday.setDate(diff); monday.setHours(0,0,0,0);
      return monday.toISOString().slice(0, 10);
    }

    for (const order of orders) {
      const key = getBucket(new Date(order.createdAt));
      revenueMap.set(key, (revenueMap.get(key) || 0) + parseFloat(order.total));
      ordersMap.set(key, (ordersMap.get(key) || 0) + 1);
    }
    for (const user of users) {
      const key = getBucket(new Date(user.createdAt));
      usersMap.set(key, (usersMap.get(key) || 0) + 1);
    }

    const timeline = allBuckets.map(key => ({
      key,
      label: formatLabel(key, unit),
      revenue: Math.round((revenueMap.get(key) || 0) * 83),
      orders:  ordersMap.get(key) || 0,
      customers: usersMap.get(key) || 0,
    }));

    // ── Summary for the period ──
    const totalRevenue  = orders.reduce((s, o) => s + parseFloat(o.total), 0);
    const totalOrders   = orders.length;
    const avgOrderValue = totalOrders > 0 ? totalRevenue / totalOrders : 0;
    const totalCustomers = users.length;

    // Compare with previous period of the same length
    const prevStart = new Date(start);
    const diffMs = Date.now() - start.getTime();
    prevStart.setTime(start.getTime() - diffMs);
    const prevOrders = await db.select({ total: ordersTable.total }).from(ordersTable)
      .where(and(gte(ordersTable.createdAt, prevStart), sql`${ordersTable.createdAt} < ${start}`));
    const prevRevenue = prevOrders.reduce((s, o) => s + parseFloat(o.total), 0);
    const prevOrderCount = prevOrders.length;
    const revenueChange = prevRevenue > 0 ? ((totalRevenue - prevRevenue) / prevRevenue) * 100 : null;
    const ordersChange  = prevOrderCount > 0 ? ((totalOrders - prevOrderCount) / prevOrderCount) * 100 : null;

    // ── Status breakdown ──
    const statusMap = new Map<string, number>();
    for (const order of orders) {
      statusMap.set(order.status, (statusMap.get(order.status) || 0) + 1);
    }
    const statusBreakdown = Array.from(statusMap.entries()).map(([status, count]) => ({ status, count }));

    // ── Top products (by items ordered in period) ──
    const productSales = new Map<number, { name: string; qty: number; revenue: number }>();
    for (const order of orders) {
      const items = (order.items as any[]) || [];
      for (const item of items) {
        const existing = productSales.get(item.productId) || { name: item.productName || `#${item.productId}`, qty: 0, revenue: 0 };
        productSales.set(item.productId, {
          name: item.productName || existing.name,
          qty: existing.qty + item.quantity,
          revenue: existing.revenue + item.price * item.quantity,
        });
      }
    }
    const topProducts = Array.from(productSales.entries())
      .map(([id, v]) => ({ productId: id, name: v.name, qty: v.qty, revenue: Math.round(v.revenue * 83) }))
      .sort((a, b) => b.qty - a.qty)
      .slice(0, 8);

    // ── Coupon analytics ──
    // Fetch all coupons so we can look up type/face-value by code
    const allCoupons = await db.select().from(couponsTable);
    const couponMeta = new Map(allCoupons.map(c => [c.code, c]));

    const couponMap = new Map<string, { uses: number; totalDiscount: number; totalRevenue: number }>();
    for (const order of orders) {
      if (!order.couponCode) continue;
      const code = order.couponCode.toUpperCase();
      const existing = couponMap.get(code) || { uses: 0, totalDiscount: 0, totalRevenue: 0 };
      const discount = parseFloat(order.discount || "0");
      const revenue  = parseFloat(order.total);
      couponMap.set(code, {
        uses:          existing.uses + 1,
        totalDiscount: existing.totalDiscount + discount,
        totalRevenue:  existing.totalRevenue + revenue,
      });
    }

    const couponStats = Array.from(couponMap.entries())
      .map(([code, v]) => {
        const meta = couponMeta.get(code);
        return {
          code,
          discountType:  meta?.discountType  ?? "flat",
          discountValue: meta ? parseFloat(meta.discountValue) : 0,
          uses:          v.uses,
          totalDiscount: Math.round(v.totalDiscount * 83),
          revenueAfter:  Math.round(v.totalRevenue  * 83),
          revenueBefore: Math.round((v.totalRevenue + v.totalDiscount) * 83),
        };
      })
      .sort((a, b) => b.uses - a.uses);

    // ── Coupon summary ──
    const totalCouponOrders  = couponStats.reduce((s, c) => s + c.uses, 0);
    const totalDiscountGiven = couponStats.reduce((s, c) => s + c.totalDiscount, 0);

    res.json({
      period,
      timeline,
      summary: {
        totalRevenue: Math.round(totalRevenue * 83),
        totalOrders,
        avgOrderValue: Math.round(avgOrderValue * 83),
        totalCustomers,
        revenueChange: revenueChange !== null ? Math.round(revenueChange * 10) / 10 : null,
        ordersChange:  ordersChange  !== null ? Math.round(ordersChange  * 10) / 10 : null,
      },
      statusBreakdown,
      topProducts,
      couponStats,
      couponSummary: { totalCouponOrders, totalDiscountGiven },
    });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Failed to generate report" });
  }
});

export default router;
