import { Router } from "express";
import bcrypt from "bcryptjs";
import { db } from "@workspace/db";
import { usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { signToken } from "../lib/auth";
import { sendAdminOtpEmail } from "../lib/mailgun";

const router = Router();

/* ── In-memory stores ── */
const otpStore = new Map<string, { otp: string; expires: number }>();
const loginAttempts = new Map<string, { count: number; lockedUntil?: number }>();

const MAX_ATTEMPTS = 5;
const OTP_TTL = 5 * 60 * 1000; // 5 minutes
const LOCK_TTL = 30 * 60 * 1000; // 30 minutes

function adminEmail() { return (process.env.ADMIN_EMAIL ?? "").toLowerCase().trim(); }
function masterPwd() { return process.env.ADMIN_MASTER_PASSWORD ?? ""; }

function genOtp() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

function storeOtp(key: string) {
  const otp = genOtp();
  otpStore.set(key, { otp, expires: Date.now() + OTP_TTL });
  return otp;
}

function verifyOtp(key: string, otp: string): boolean {
  const stored = otpStore.get(key);
  if (!stored || Date.now() > stored.expires) return false;
  if (stored.otp !== otp) return false;
  otpStore.delete(key);
  return true;
}

function toUser(u: any) {
  return { id: u.id, email: u.email, name: u.name, role: u.role };
}

/* ── POST /admin-auth/login ── */
router.post("/admin-auth/login", async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) { res.status(400).json({ error: "Email and password required" }); return; }

    const aEmail = adminEmail();
    if (!aEmail) { res.status(500).json({ error: "ADMIN_EMAIL not configured on server" }); return; }
    if (email.toLowerCase().trim() !== aEmail) { res.status(401).json({ error: "Invalid credentials" }); return; }

    const key = `login:${aEmail}`;
    const att = loginAttempts.get(key) ?? { count: 0 };

    /* Locked out */
    if (att.lockedUntil && Date.now() < att.lockedUntil) {
      res.status(429).json({ error: "Account locked. Use OTP to login.", requireOtp: true });
      return;
    }

    const [user] = await db.select().from(usersTable).where(eq(usersTable.email, aEmail));
    if (!user || user.role !== "admin") { res.status(401).json({ error: "Admin account not found" }); return; }

    const valid = user.passwordHash ? await bcrypt.compare(password, user.passwordHash) : false;

    if (!valid) {
      const count = att.count + 1;
      if (count >= MAX_ATTEMPTS) {
        loginAttempts.set(key, { count, lockedUntil: Date.now() + LOCK_TTL });
        const otp = storeOtp(`login:otp:${aEmail}`);
        await sendAdminOtpEmail(aEmail, otp, "login");
        res.status(429).json({
          error: `${MAX_ATTEMPTS} failed attempts. OTP sent to admin email.`,
          requireOtp: true,
        });
      } else {
        loginAttempts.set(key, { count });
        res.status(401).json({
          error: `Invalid credentials. ${MAX_ATTEMPTS - count} attempt${MAX_ATTEMPTS - count === 1 ? "" : "s"} remaining.`,
          attemptsLeft: MAX_ATTEMPTS - count,
        });
      }
      return;
    }

    /* Success */
    loginAttempts.delete(key);
    const token = signToken({ id: user.id, email: user.email, role: user.role });
    res.json({ token, user: toUser(user) });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Login failed" });
  }
});

/* ── POST /admin-auth/send-otp ── sends OTP to admin email */
router.post("/admin-auth/send-otp", async (req, res) => {
  try {
    const { purpose = "login" } = req.body;
    const aEmail = adminEmail();
    if (!aEmail) { res.status(500).json({ error: "ADMIN_EMAIL not configured" }); return; }
    const otp = storeOtp(`${purpose}:otp:${aEmail}`);
    const sent = await sendAdminOtpEmail(aEmail, otp, purpose as any);
    if (!sent) { res.status(500).json({ error: "Failed to send OTP. Check Mailgun config." }); return; }
    res.json({ success: true, message: "OTP sent to admin email" });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Failed to send OTP" });
  }
});

/* ── POST /admin-auth/verify-otp ── login via OTP */
router.post("/admin-auth/verify-otp", async (req, res) => {
  try {
    const { otp } = req.body;
    const aEmail = adminEmail();
    if (!otp) { res.status(400).json({ error: "OTP required" }); return; }
    if (!verifyOtp(`login:otp:${aEmail}`, otp)) {
      res.status(400).json({ error: "Invalid or expired OTP" });
      return;
    }
    const [user] = await db.select().from(usersTable).where(eq(usersTable.email, aEmail));
    if (!user) { res.status(404).json({ error: "Admin not found" }); return; }
    loginAttempts.delete(`login:${aEmail}`);
    const token = signToken({ id: user.id, email: user.email, role: user.role });
    res.json({ token, user: toUser(user) });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "OTP verification failed" });
  }
});

/* ── POST /admin-auth/create-send-otp ── step 1 of create admin */
router.post("/admin-auth/create-send-otp", async (req, res) => {
  try {
    const { masterPassword } = req.body;
    if (!masterPassword) { res.status(400).json({ error: "Master password required" }); return; }
    if (masterPassword !== masterPwd()) { res.status(403).json({ error: "Invalid master password" }); return; }
    const aEmail = adminEmail();
    if (!aEmail) { res.status(500).json({ error: "ADMIN_EMAIL not configured" }); return; }
    const otp = storeOtp(`create:otp:${aEmail}`);
    const sent = await sendAdminOtpEmail(aEmail, otp, "create");
    if (!sent) { res.status(500).json({ error: "Failed to send OTP" }); return; }
    res.json({ success: true });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Failed" });
  }
});

/* ── POST /admin-auth/create ── step 2: create admin with OTP */
router.post("/admin-auth/create", async (req, res) => {
  try {
    const { name, email, password, masterPassword, otp } = req.body;
    if (!name || !email || !password || !masterPassword || !otp) {
      res.status(400).json({ error: "All fields are required" }); return;
    }
    if (masterPassword !== masterPwd()) { res.status(403).json({ error: "Invalid master password" }); return; }

    const aEmail = adminEmail();
    if (!verifyOtp(`create:otp:${aEmail}`, otp)) {
      res.status(400).json({ error: "Invalid or expired OTP" }); return;
    }
    if (password.length < 8) { res.status(400).json({ error: "Password must be at least 8 characters" }); return; }

    const emailLower = email.toLowerCase().trim();
    const passwordHash = await bcrypt.hash(password, 10);
    const [existing] = await db.select().from(usersTable).where(eq(usersTable.email, emailLower));

    if (existing) {
      const [updated] = await db.update(usersTable)
        .set({ role: "admin", passwordHash, name })
        .where(eq(usersTable.email, emailLower))
        .returning();
      const token = signToken({ id: updated.id, email: updated.email, role: updated.role });
      res.json({ token, user: toUser(updated) });
    } else {
      const [user] = await db.insert(usersTable)
        .values({ email: emailLower, passwordHash, name, role: "admin" })
        .returning();
      const token = signToken({ id: user.id, email: user.email, role: user.role });
      res.json({ token, user: toUser(user) });
    }
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Failed to create admin" });
  }
});

/* ── POST /admin-auth/forgot-password ── send OTP for reset */
router.post("/admin-auth/forgot-password", async (req, res) => {
  try {
    const aEmail = adminEmail();
    if (!aEmail) { res.status(500).json({ error: "ADMIN_EMAIL not configured" }); return; }
    const otp = storeOtp(`reset:otp:${aEmail}`);
    const sent = await sendAdminOtpEmail(aEmail, otp, "reset");
    if (!sent) { res.status(500).json({ error: "Failed to send OTP" }); return; }
    res.json({ success: true });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Failed" });
  }
});

/* ── POST /admin-auth/reset-password ── verify OTP + set new password */
router.post("/admin-auth/reset-password", async (req, res) => {
  try {
    const { otp, newPassword } = req.body;
    const aEmail = adminEmail();
    if (!otp || !newPassword) { res.status(400).json({ error: "OTP and new password required" }); return; }
    if (newPassword.length < 8) { res.status(400).json({ error: "Password must be at least 8 characters" }); return; }
    if (!verifyOtp(`reset:otp:${aEmail}`, otp)) {
      res.status(400).json({ error: "Invalid or expired OTP" }); return;
    }
    const passwordHash = await bcrypt.hash(newPassword, 10);
    await db.update(usersTable).set({ passwordHash }).where(eq(usersTable.email, aEmail));
    res.json({ success: true });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Reset failed" });
  }
});

export default router;
