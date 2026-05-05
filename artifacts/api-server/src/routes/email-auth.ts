import { Router } from "express";
import bcrypt from "bcryptjs";
import crypto from "crypto";
import { db } from "@workspace/db";
import { usersTable, emailOtpsTable, passwordResetTokensTable } from "@workspace/db";
import { eq, and, gt } from "drizzle-orm";
import { signToken } from "../lib/auth";
import { sendOtpEmail, sendPasswordResetEmail } from "../lib/mailgun";
import { isEmailEnabled } from "../lib/emailSettings";

const router = Router();

function generateOtp(): string {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

function generateToken(): string {
  return crypto.randomBytes(32).toString("hex");
}

function getAppUrl(req: any): string {
  const host = req.headers["x-forwarded-host"] || req.headers.host || "localhost:8081";
  const proto = req.headers["x-forwarded-proto"] || "https";
  return `${proto}://${host}`;
}

function toUser(u: any) {
  return { id: u.id, email: u.email, name: u.name, avatar: u.avatar, role: u.role, createdAt: u.createdAt?.toISOString() };
}

// POST /auth/send-otp — send OTP for email verification during signup
router.post("/auth/send-otp", async (req, res) => {
  try {
    const { email, name } = req.body;
    if (!email) { res.status(400).json({ error: "Email is required" }); return; }

    // Check if email already registered
    const [existing] = await db.select().from(usersTable).where(eq(usersTable.email, email));
    if (existing) {
      res.status(409).json({ error: "This email is already registered. Please sign in instead." });
      return;
    }

    const otp = generateOtp();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

    // Invalidate old OTPs for this email
    await db.update(emailOtpsTable)
      .set({ used: true })
      .where(and(eq(emailOtpsTable.email, email), eq(emailOtpsTable.type, "verify")));

    await db.insert(emailOtpsTable).values({ email, otp, type: "verify", expiresAt });

    const otpEnabled = await isEmailEnabled("otpVerification");
    if (otpEnabled) {
      const sent = await sendOtpEmail(email, otp, name || "there");
      if (!sent) {
        res.status(500).json({ error: "Failed to send verification email. Please try again." });
        return;
      }
    }

    res.json({ success: true, message: "Verification code sent to your email." });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Failed to send OTP" });
  }
});

// POST /auth/verify-otp — verify OTP and complete registration
router.post("/auth/verify-otp", async (req, res) => {
  try {
    const { email, otp, name, password } = req.body;
    if (!email || !otp || !name || !password) {
      res.status(400).json({ error: "All fields are required" });
      return;
    }

    // Find valid OTP
    const [record] = await db.select().from(emailOtpsTable).where(
      and(
        eq(emailOtpsTable.email, email),
        eq(emailOtpsTable.type, "verify"),
        eq(emailOtpsTable.used, false),
        gt(emailOtpsTable.expiresAt, new Date())
      )
    );

    if (!record) {
      res.status(400).json({ error: "Invalid or expired verification code." });
      return;
    }

    if (record.otp !== otp) {
      res.status(400).json({ error: "Incorrect verification code." });
      return;
    }

    // Mark OTP used
    await db.update(emailOtpsTable).set({ used: true }).where(eq(emailOtpsTable.id, record.id));

    // Check again in case of race
    const [existing] = await db.select().from(usersTable).where(eq(usersTable.email, email));
    if (existing) {
      res.status(409).json({ error: "Email already registered." });
      return;
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const [user] = await db.insert(usersTable).values({ email, passwordHash, name, role: "user" }).returning();
    const token = signToken({ id: user.id, email: user.email, role: user.role });

    res.status(201).json({ user: toUser(user), token });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Registration failed" });
  }
});

// POST /auth/forgot-password — send reset link
router.post("/auth/forgot-password", async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) { res.status(400).json({ error: "Email is required" }); return; }

    const [user] = await db.select().from(usersTable).where(eq(usersTable.email, email));

    // Always respond success to avoid user enumeration
    if (!user) {
      res.json({ success: true, message: "If this email exists, a reset link has been sent." });
      return;
    }

    const token = generateToken();
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

    await db.insert(passwordResetTokensTable).values({ userId: user.id, token, expiresAt });

    const appUrl = getAppUrl(req);
    const resetLink = `${appUrl}/reset-password?token=${token}`;

    const resetEnabled = await isEmailEnabled("passwordReset");
    if (resetEnabled) {
      await sendPasswordResetEmail(user.email, user.name, resetLink);
    }

    res.json({ success: true, message: "If this email exists, a reset link has been sent." });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Failed to process request" });
  }
});

// POST /auth/reset-password — set new password using token
router.post("/auth/reset-password", async (req, res) => {
  try {
    const { token, password } = req.body;
    if (!token || !password) { res.status(400).json({ error: "Token and password are required" }); return; }
    if (password.length < 8) { res.status(400).json({ error: "Password must be at least 8 characters" }); return; }

    const [record] = await db.select().from(passwordResetTokensTable).where(
      and(
        eq(passwordResetTokensTable.token, token),
        eq(passwordResetTokensTable.used, false),
        gt(passwordResetTokensTable.expiresAt, new Date())
      )
    );

    if (!record) {
      res.status(400).json({ error: "This reset link is invalid or has expired." });
      return;
    }

    const passwordHash = await bcrypt.hash(password, 10);
    await db.update(usersTable).set({ passwordHash }).where(eq(usersTable.id, record.userId));
    await db.update(passwordResetTokensTable).set({ used: true }).where(eq(passwordResetTokensTable.id, record.id));

    res.json({ success: true, message: "Password reset successfully. You can now sign in." });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Failed to reset password" });
  }
});

// POST /auth/check-email — check if email exists (for forgot password UX)
router.post("/auth/check-email", async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) { res.status(400).json({ error: "Email is required" }); return; }
    const [user] = await db.select({ id: usersTable.id }).from(usersTable).where(eq(usersTable.email, email));
    res.json({ exists: !!user });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Failed" });
  }
});

export default router;
