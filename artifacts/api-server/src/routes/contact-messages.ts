import { Router } from "express";
import { db } from "@workspace/db";
import { contactMessagesTable } from "@workspace/db";
import { eq, desc, sql } from "drizzle-orm";
import { requireAdmin } from "../lib/auth";

const router = Router();

function toMessage(m: any) {
  return { id: m.id, firstName: m.firstName, lastName: m.lastName, email: m.email, subject: m.subject, message: m.message, isRead: m.isRead, replied: m.replied, repliedAt: m.repliedAt?.toISOString() || null, adminReply: m.adminReply || null, createdAt: m.createdAt?.toISOString() };
}

router.post("/contact-messages", async (req, res) => {
  try {
    const { firstName, lastName, email, subject, message } = req.body;
    if (!firstName || !lastName || !email || !subject || !message) { res.status(400).json({ error: "All fields are required" }); return; }
    const [msg] = await db.insert(contactMessagesTable).values({ firstName, lastName, email, subject, message }).returning();
    res.status(201).json(toMessage(msg));
  } catch (err) { req.log.error(err); res.status(500).json({ error: "Failed to send message" }); }
});

router.get("/contact-messages", requireAdmin, async (req, res) => {
  try {
    const { page = 1, limit = 50 } = req.query;
    const offset = (Number(page) - 1) * Number(limit);
    const messages = await db.select().from(contactMessagesTable).orderBy(desc(contactMessagesTable.createdAt)).limit(Number(limit)).offset(offset);
    const [countResult] = await db.select({ count: sql`count(*)` }).from(contactMessagesTable);
    const [unreadResult] = await db.select({ count: sql`count(*)` }).from(contactMessagesTable).where(eq(contactMessagesTable.isRead, false));
    res.json({ messages: messages.map(toMessage), total: Number(countResult?.count || 0), unread: Number(unreadResult?.count || 0), page: Number(page), limit: Number(limit) });
  } catch (err) { req.log.error(err); res.status(500).json({ error: "Failed to list messages" }); }
});

router.get("/contact-messages/:id", requireAdmin, async (req, res) => {
  try {
    const id = parseInt(req.params.id as string);
    const [msg] = await db.select().from(contactMessagesTable).where(eq(contactMessagesTable.id, id));
    if (!msg) { res.status(404).json({ error: "Not found" }); return; }
    if (!msg.isRead) await db.update(contactMessagesTable).set({ isRead: true }).where(eq(contactMessagesTable.id, id));
    res.json(toMessage({ ...msg, isRead: true }));
  } catch (err) { req.log.error(err); res.status(500).json({ error: "Failed" }); }
});

router.put("/contact-messages/:id", requireAdmin, async (req, res) => {
  try {
    const id = parseInt(req.params.id as string);
    const { isRead } = req.body;
    const [msg] = await db.update(contactMessagesTable).set({ isRead }).where(eq(contactMessagesTable.id, id)).returning();
    if (!msg) { res.status(404).json({ error: "Not found" }); return; }
    res.json(toMessage(msg));
  } catch (err) { req.log.error(err); res.status(500).json({ error: "Failed" }); }
});

/* ── Admin: delete a contact message ── */
router.delete("/contact-messages/:id", requireAdmin, async (req, res) => {
  try {
    const id = parseInt(req.params.id as string);
    await db.delete(contactMessagesTable).where(eq(contactMessagesTable.id, id));
    res.json({ success: true });
  } catch (err) { req.log.error(err); res.status(500).json({ error: "Failed to delete message" }); }
});

router.post("/contact-messages/:id/reply", requireAdmin, async (req, res) => {
  try {
    const id = parseInt(req.params.id as string);
    const { replyText } = req.body;
    if (!replyText) { res.status(400).json({ error: "Reply text is required" }); return; }
    const [msg] = await db.select().from(contactMessagesTable).where(eq(contactMessagesTable.id, id));
    if (!msg) { res.status(404).json({ error: "Not found" }); return; }
    const RESEND_API_KEY = process.env.RESEND_API_KEY;
    let emailSent = false;
    if (RESEND_API_KEY) {
      try {
        const response = await fetch("https://api.resend.com/emails", { method: "POST", headers: { "Authorization": `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" }, body: JSON.stringify({ from: "Pearlis Jewellery <concierge@pearlis.com>", to: [msg.email], subject: `Re: ${msg.subject}`, html: `<div style="font-family: Georgia, serif; max-width: 600px; margin: 0 auto; color: #1a1a1a;"><div style="border-bottom: 1px solid #c9a84c; padding-bottom: 20px; margin-bottom: 30px;"><h1 style="font-size: 28px; letter-spacing: 4px; color: #1a1a1a; margin: 0;">PEARLIS</h1><p style="color: #888; font-size: 11px; letter-spacing: 3px; margin: 4px 0 0;">FINE JEWELLERY</p></div><p style="color: #666; font-size: 14px;">Dear ${msg.firstName},</p><div style="background: #faf9f7; border-left: 3px solid #c9a84c; padding: 20px; margin: 20px 0; font-size: 15px; line-height: 1.7;">${replyText.replace(/\n/g, "<br>")}</div><p style="color: #666; font-size: 14px;">Warm regards,<br><strong>Pearlis Concierge Team</strong></p></div>` }) });
        emailSent = response.ok;
      } catch (emailErr) { req.log.error(emailErr, "Failed to send email via Resend"); }
    }
    const [updated] = await db.update(contactMessagesTable).set({ replied: true, repliedAt: new Date(), adminReply: replyText, isRead: true }).where(eq(contactMessagesTable.id, id)).returning();
    res.json({ message: toMessage(updated), emailSent, resendConfigured: !!RESEND_API_KEY });
  } catch (err) { req.log.error(err); res.status(500).json({ error: "Failed to send reply" }); }
});

router.post("/contact-messages/bulk-reply", requireAdmin, async (req, res) => {
  try {
    const { ids, replyText } = req.body;
    if (!ids || !Array.isArray(ids) || !replyText) { res.status(400).json({ error: "ids array and replyText are required" }); return; }
    const RESEND_API_KEY = process.env.RESEND_API_KEY;
    const results: Array<{ id: number; emailSent: boolean; email: string }> = [];
    for (const id of ids) {
      const [msg] = await db.select().from(contactMessagesTable).where(eq(contactMessagesTable.id, id));
      if (!msg) continue;
      let emailSent = false;
      if (RESEND_API_KEY) {
        try {
          const response = await fetch("https://api.resend.com/emails", { method: "POST", headers: { "Authorization": `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" }, body: JSON.stringify({ from: "Pearlis Jewellery <concierge@pearlis.com>", to: [msg.email], subject: `Re: ${msg.subject}`, html: `<p>Dear ${msg.firstName},</p><div>${replyText.replace(/\n/g, "<br>")}</div><p>Warm regards,<br>Pearlis Concierge Team</p>` }) });
          emailSent = response.ok;
        } catch { }
      }
      await db.update(contactMessagesTable).set({ replied: true, repliedAt: new Date(), adminReply: replyText, isRead: true }).where(eq(contactMessagesTable.id, id));
      results.push({ id, emailSent, email: msg.email });
    }
    res.json({ results, resendConfigured: !!RESEND_API_KEY });
  } catch (err) { req.log.error(err); res.status(500).json({ error: "Failed to send bulk reply" }); }
});

export default router;
