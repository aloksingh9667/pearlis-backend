import { Router } from "express";
import { db } from "@workspace/db";
import { newsletterTable } from "@workspace/db";
import { eq, desc } from "drizzle-orm";
import { requireAdmin } from "../lib/auth";

const router = Router();

/* ── Public: subscribe ── */
router.post("/newsletter/subscribe", async (req, res) => {
  try {
    const { email } = req.body;
    if (!email || !email.includes("@")) {
      res.status(400).json({ error: "A valid email address is required." });
      return;
    }
    const emailLower = email.toLowerCase().trim();

    /* gracefully handle duplicate */
    const [existing] = await db
      .select()
      .from(newsletterTable)
      .where(eq(newsletterTable.email, emailLower));

    if (existing) {
      res.json({ success: true, message: "You are already subscribed. Thank you!" });
      return;
    }

    await db.insert(newsletterTable).values({ email: emailLower });
    res.status(201).json({ success: true, message: "Welcome to The Pearlis Edit. Thank you for subscribing!" });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Failed to subscribe. Please try again." });
  }
});

/* ── Admin: list subscribers ── */
router.get("/admin/newsletter", requireAdmin, async (req, res) => {
  try {
    const subscribers = await db
      .select()
      .from(newsletterTable)
      .orderBy(desc(newsletterTable.subscribedAt));
    res.json(
      subscribers.map((s) => ({
        id: s.id,
        email: s.email,
        subscribedAt: s.subscribedAt?.toISOString(),
      }))
    );
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Failed to list subscribers" });
  }
});

/* ── Admin: delete subscriber ── */
router.delete("/admin/newsletter/:id", requireAdmin, async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    await db.delete(newsletterTable).where(eq(newsletterTable.id, id));
    res.json({ success: true });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Failed to delete subscriber" });
  }
});

export default router;
