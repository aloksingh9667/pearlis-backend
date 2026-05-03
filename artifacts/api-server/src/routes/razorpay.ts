import { Router } from "express";
import crypto from "crypto";
import { requireAdmin } from "../lib/auth";

const router = Router();

function getRazorpayInstance() {
  const keyId = process.env.RAZORPAY_KEY_ID;
  const keySecret = process.env.RAZORPAY_KEY_SECRET;
  if (!keyId || !keySecret) return null;
  const Razorpay = require("razorpay");
  return new Razorpay({ key_id: keyId, key_secret: keySecret });
}

router.get("/razorpay/config", (_req, res) => {
  const keyId = process.env.RAZORPAY_KEY_ID;
  if (!keyId) {
    res.json({ enabled: false });
    return;
  }
  res.json({ enabled: true, keyId });
});

router.post("/razorpay/create-order", async (req, res) => {
  try {
    const instance = getRazorpayInstance();
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

router.post("/razorpay/verify", (req, res) => {
  try {
    const keySecret = process.env.RAZORPAY_KEY_SECRET;
    if (!keySecret) { res.status(503).json({ error: "Razorpay not configured" }); return; }
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
