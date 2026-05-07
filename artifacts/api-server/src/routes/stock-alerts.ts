import { Router } from "express";
import { db } from "@workspace/db";
import { stockAlertsTable, productsTable } from "@workspace/db";
import { eq, and, isNull } from "drizzle-orm";
import { sendStockAlertEmail } from "../lib/mailgun";
import { requireAdmin } from "../lib/auth";
import { isEmailEnabled } from "../lib/emailSettings";

const router = Router();

const APP_URL = process.env.APP_URL || "https://pearlis.pages.dev";

/* ── Public: subscribe to back-in-stock alert ── */
router.post("/stock-alerts", async (req, res) => {
  try {
    const { productId, email } = req.body;
    if (!productId || !email) return res.status(400).json({ error: "productId and email are required" });
    const emailLower = email.toLowerCase().trim();
    const [product] = await db.select().from(productsTable).where(eq(productsTable.id, parseInt(productId)));
    if (!product) return res.status(404).json({ error: "Product not found" });
    const [existing] = await db.select().from(stockAlertsTable).where(and(eq(stockAlertsTable.productId, parseInt(productId)), eq(stockAlertsTable.email, emailLower), isNull(stockAlertsTable.notifiedAt)));
    if (existing) return res.json({ success: true, message: "Already subscribed" });
    await db.insert(stockAlertsTable).values({ productId: parseInt(productId), email: emailLower });
    res.status(201).json({ success: true });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Failed to subscribe" });
  }
});

/* ── Admin: list all stock alerts ── */
router.get("/admin/stock-alerts", requireAdmin, async (req, res) => {
  try {
    const rows = await db.select({ id: stockAlertsTable.id, email: stockAlertsTable.email, productId: stockAlertsTable.productId, productName: productsTable.name, notifiedAt: stockAlertsTable.notifiedAt, createdAt: stockAlertsTable.createdAt }).from(stockAlertsTable).leftJoin(productsTable, eq(stockAlertsTable.productId, productsTable.id));
    res.json(rows.map(r => ({ ...r, notifiedAt: r.notifiedAt?.toISOString() ?? null, createdAt: r.createdAt?.toISOString() })));
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Failed" });
  }
});

/* ── Admin: delete a single stock alert subscriber ── */
router.delete("/admin/stock-alerts/:id", requireAdmin, async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    await db.delete(stockAlertsTable).where(eq(stockAlertsTable.id, id));
    res.json({ success: true });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Failed to delete alert" });
  }
});

/* ── Admin: delete all alerts for a product ── */
router.delete("/admin/stock-alerts/product/:productId", requireAdmin, async (req, res) => {
  try {
    const productId = parseInt(req.params.productId);
    await db.delete(stockAlertsTable).where(eq(stockAlertsTable.productId, productId));
    res.json({ success: true });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Failed to delete alerts" });
  }
});

/* ── Admin: trigger back-in-stock notifications for a product ── */
router.post("/admin/stock-alerts/:productId/notify", requireAdmin, async (req, res) => {
  try {
    const productId = parseInt(req.params.productId);
    if (isNaN(productId)) { res.status(400).json({ error: "Invalid productId" }); return; }
    const [product] = await db.select().from(productsTable).where(eq(productsTable.id, productId));
    if (!product) { res.status(404).json({ error: "Product not found" }); return; }
    const pendingAlerts = await db.select().from(stockAlertsTable).where(and(eq(stockAlertsTable.productId, productId), isNull(stockAlertsTable.notifiedAt)));
    if (pendingAlerts.length === 0) { res.json({ success: true, notified: 0, message: "No pending alerts for this product." }); return; }
    const productUrl = `${APP_URL}/product/${productId}`;
    let notified = 0;
    const emailEnabled = await isEmailEnabled("stockAlert");
    for (const alert of pendingAlerts) {
      if (!emailEnabled) { notified++; continue; }
      const sent = await sendStockAlertEmail(alert.email, product.name, productUrl);
      if (sent) {
        await db.update(stockAlertsTable).set({ notifiedAt: new Date() }).where(eq(stockAlertsTable.id, alert.id));
        notified++;
      }
    }
    res.json({ success: true, notified, total: pendingAlerts.length, message: `Notified ${notified} of ${pendingAlerts.length} customer${pendingAlerts.length !== 1 ? "s" : ""}.` });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Failed to send notifications" });
  }
});

/* ── Internal: trigger stock alert emails for a product ── */
export async function triggerStockAlerts(productId: number, productName: string, productUrl: string) {
  try {
    const emailEnabled = await isEmailEnabled("stockAlert");
    const alerts = await db.select().from(stockAlertsTable).where(and(eq(stockAlertsTable.productId, productId), isNull(stockAlertsTable.notifiedAt)));
    for (const alert of alerts) {
      if (emailEnabled) {
        const sent = await sendStockAlertEmail(alert.email, productName, productUrl);
        if (sent) {
          await db.update(stockAlertsTable).set({ notifiedAt: new Date() }).where(eq(stockAlertsTable.id, alert.id));
        }
      }
    }
    return alerts.length;
  } catch (err) {
    console.error("triggerStockAlerts error:", err);
    return 0;
  }
}

export default router;
