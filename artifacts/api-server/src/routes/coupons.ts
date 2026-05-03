import { Router } from "express";
import { db } from "@workspace/db";
import { couponsTable, newsletterTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { requireAdmin } from "../lib/auth";

const router = Router();

function toCoupon(c: any) {
  return {
    id: c.id, code: c.code, discountType: c.discountType,
    discountValue: parseFloat(c.discountValue),
    minOrderAmount: c.minOrderAmount ? parseFloat(c.minOrderAmount) : null,
    maxUses: c.maxUses, usedCount: c.usedCount, isActive: c.isActive,
    expiresAt: c.expiresAt?.toISOString() || null,
  };
}

router.get("/coupons", requireAdmin, async (req, res) => {
  try {
    const coupons = await db.select().from(couponsTable);
    res.json(coupons.map(toCoupon));
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Failed" });
  }
});

router.post("/coupons", requireAdmin, async (req, res) => {
  try {
    const body = req.body;
    const [coupon] = await db.insert(couponsTable).values({
      code: body.code.toUpperCase(), discountType: body.discountType,
      discountValue: body.discountValue.toString(),
      minOrderAmount: body.minOrderAmount?.toString(),
      maxUses: body.maxUses,
      expiresAt: body.expiresAt ? new Date(body.expiresAt) : null,
    }).returning();
    res.status(201).json(toCoupon(coupon));
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Failed to create coupon" });
  }
});

// PATCH /coupons/:id — toggle isActive
router.patch("/coupons/:id", requireAdmin, async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const { isActive } = req.body;
    const [coupon] = await db.update(couponsTable)
      .set({ isActive })
      .where(eq(couponsTable.id, id))
      .returning();
    res.json(toCoupon(coupon));
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Failed to update coupon" });
  }
});

router.delete("/coupons/:id", requireAdmin, async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    await db.delete(couponsTable).where(eq(couponsTable.id, id));
    res.json({ success: true, message: "Deleted" });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Failed to delete coupon" });
  }
});

// POST /coupons/validate — public, validate a coupon code against a subtotal
router.post("/coupons/validate", async (req, res) => {
  try {
    const { code, subtotal } = req.body;
    if (!code) { res.status(400).json({ error: "Coupon code required" }); return; }

    const [coupon] = await db.select().from(couponsTable).where(eq(couponsTable.code, code.toUpperCase()));
    if (!coupon || !coupon.isActive) {
      res.status(400).json({ error: "Invalid or inactive coupon code" }); return;
    }
    if (coupon.expiresAt && new Date(coupon.expiresAt) < new Date()) {
      res.status(400).json({ error: "Coupon has expired" }); return;
    }
    if (coupon.maxUses && coupon.usedCount >= coupon.maxUses) {
      res.status(400).json({ error: "Coupon usage limit reached" }); return;
    }
    if (coupon.minOrderAmount && subtotal < parseFloat(coupon.minOrderAmount)) {
      const minINR = Math.round(parseFloat(coupon.minOrderAmount) * 83);
      res.status(400).json({ error: `Minimum order amount of ₹${minINR.toLocaleString("en-IN")} required` }); return;
    }

    const sub = parseFloat(subtotal) || 0;
    let discount = 0;
    if (coupon.discountType === "percentage") {
      discount = sub * parseFloat(coupon.discountValue) / 100;
    } else {
      discount = parseFloat(coupon.discountValue);
    }

    const discountINR = Math.round(discount * 83);
    const message = coupon.discountType === "percentage"
      ? `${coupon.discountValue}% off — saving ₹${discountINR.toLocaleString("en-IN")}`
      : `₹${discountINR.toLocaleString("en-IN")} off applied`;

    res.json({
      valid: true,
      code: coupon.code,
      discountType: coupon.discountType,
      discountValue: parseFloat(coupon.discountValue),
      discount,
      message,
    });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Failed to validate coupon" });
  }
});

router.post("/newsletter/subscribe", async (req, res) => {
  try {
    const { email } = req.body;
    try {
      await db.insert(newsletterTable).values({ email });
    } catch {
      // Already subscribed - that's ok
    }
    res.json({ success: true, message: "Subscribed successfully" });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Failed to subscribe" });
  }
});

export default router;
