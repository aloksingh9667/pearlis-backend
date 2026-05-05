import { Router } from "express";
import crypto from "crypto";
import { db } from "@workspace/db";
import { siteSettingsTable } from "@workspace/db";
import { eq } from "drizzle-orm";

const router = Router();

async function getRazorpayMode(): Promise<"test" | "live"> {
  try {
    const [setting] = await db.select().from(siteSettingsTable).where(eq(siteSettingsTable.key, "payment"));
    if (setting?.value && typeof setting.value === "object") {
      return (setting.value as any).razorpayMode === "live" ? "live" : "test";
    }
  } catch {}
  return "test";
}

function getKeys(mode: "test" | "live") {
  if (mode === "live") {
    return {
      keyId: process.env.RAZORPAY_LIVE_KEY_ID || process.env.RAZORPAY_KEY_ID || "",
      keySecret: process.env.RAZORPAY_LIVE_KEY_SECRET || process.env.RAZORPAY_KEY_SECRET || "",
    };
  }
  return {
    keyId: process.env.RAZORPAY_TEST_KEY_ID || "",
    keySecret: process.env.RAZORPAY_TEST_KEY_SECRET || "",
  };
}

function getRazorpayInstance(mode: "test" | "live") {
  const { keyId, keySecret } = getKeys(mode);
  if (!keyId || !keySecret) return null;
  const Razorpay = require("razorpay");
  return new Razorpay({ key_id: keyId, key_secret: keySecret });
}

router.get("/razorpay/config", async (_req, res) => {
  try {
    const mode = await getRazorpayMode();
    const { keyId } = getKeys(mode);
    if (!keyId) {
      res.json({ enabled: false });
      return;
    }
    res.json({ enabled: true, keyId, mode });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/razorpay/create-order", async (req, res) => {
  try {
    const mode = await getRazorpayMode();
    const instance = getRazorpayInstance(mode);
    if (!instance) {
      res.status(503).json({ error: "Razorpay not configured" });
      return;
    }
    const { amountINR, receipt } = req.body;
    const order = await instance.orders.create({
      amount: Math.round(amountINR) * 100,
      currency: "INR",
      receipt: receipt || `rcpt_${Date.now()}`,
    });
    res.json({ orderId: order.id, amount: order.amount, currency: order.currency });
  } catch (err: any) {
    res.status(500).json({ error: err.message || "Failed to create Razorpay order" });
  }
});

router.post("/razorpay/verify", async (req, res) => {
  try {
    const mode = await getRazorpayMode();
    const { keySecret } = getKeys(mode);
    if (!keySecret) {
      res.status(503).json({ error: "Razorpay not configured" });
      return;
    }
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;
    const body = razorpay_order_id + "|" + razorpay_payment_id;
    const expectedSignature = crypto.createHmac("sha256", keySecret).update(body).digest("hex");
    if (expectedSignature !== razorpay_signature) {
      res.status(400).json({ valid: false, error: "Signature mismatch" });
      return;
    }
    res.json({ valid: true, paymentId: razorpay_payment_id });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
