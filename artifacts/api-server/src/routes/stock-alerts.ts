import { Router } from "express";
import { db } from "@workspace/db";
import { stockAlertsTable, productsTable } from "@workspace/db";
import { eq, and, isNull } from "drizzle-orm";
import { sendStockAlertEmail } from "../lib/mailgun";

const router = Router();

/* ── Public: subscribe to back-in-stock alert ── */
router.post("/stock-alerts", async (req, res) => {
  try {
    const { productId, email } = req.body;
    if (!productId || !email) return res.status(400).json({ error: "productId and email are required" });
    const emailLower = email.toLowerCase().trim();

    /* check product exists */
    const [product] = await db.select().from(productsTable).where(eq(productsTable.id, parseInt(productId)));
    if (!product) return res.status(404).json({ error: "Product not found" });

    /* avoid duplicate un-notified alerts */
    const [existing] = await db
      .select()
      .from(stockAlertsTable)
      .where(
        and(
          eq(stockAlertsTable.productId, parseInt(productId)),
          eq(stockAlertsTable.email, emailLower),
          isNull(stockAlertsTable.notifiedAt),
        )
      );
    if (existing) return res.json({ success: true, message: "Already subscribed" });

    await db.insert(stockAlertsTable).values({ productId: parseInt(productId), email: emailLower });
    res.status(201).json({ success: true });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Failed to subscribe" });
  }
});

/* ── Admin: list all stock alerts ── */
router.get("/admin/stock-alerts", async (req, res) => {
  const user = (req as any).user;
  if (!user || user.role !== "admin") return res.status(403).json({ error: "Forbidden" });
  try {
    const rows = await db
      .select({
        id: stockAlertsTable.id,
        email: stockAlertsTable.email,
        productId: stockAlertsTable.productId,
        productName: productsTable.name,
        notifiedAt: stockAlertsTable.notifiedAt,
        createdAt: stockAlertsTable.createdAt,
      })
      .from(stockAlertsTable)
      .leftJoin(productsTable, eq(stockAlertsTable.productId, productsTable.id));
    res.json(rows.map(r => ({
      ...r,
      notifiedAt: r.notifiedAt?.toISOString() ?? null,
      createdAt: r.createdAt?.toISOString(),
    })));
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Failed" });
  }
});

/* ── Internal: trigger stock alert emails for a product ── */
export async function triggerStockAlerts(productId: number, productName: string, productUrl: string) {
  try {
    const alerts = await db
      .select()
      .from(stockAlertsTable)
      .where(and(eq(stockAlertsTable.productId, productId), isNull(stockAlertsTable.notifiedAt)));

    for (const alert of alerts) {
      const sent = await sendStockAlertEmail(alert.email, productName, productUrl);
      if (sent) {
        await db
          .update(stockAlertsTable)
          .set({ notifiedAt: new Date() })
          .where(eq(stockAlertsTable.id, alert.id));
      }
    }
    return alerts.length;
  } catch (err) {
    console.error("triggerStockAlerts error:", err);
    return 0;
  }
}

export default router;
