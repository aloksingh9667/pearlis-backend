import { Router } from "express";
import bcrypt from "bcryptjs";
import { db } from "@workspace/db";
import { usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { signToken, requireAuth, requireAdmin, hashPassword, comparePassword } from "../lib/auth";

const router = Router();

function toUser(u: any) {
  return {
    id: u.id,
    email: u.email,
    name: u.name,
    avatar: u.avatar,
    role: u.role,
    createdAt: u.createdAt?.toISOString(),
  };
}

router.post("/auth/register", async (req, res) => {
  try {
    const { email, password, name } = req.body;
    if (!email || !password || !name) {
      res.status(400).json({ error: "Missing required fields" });
      return;
    }
    const [existing] = await db.select().from(usersTable).where(eq(usersTable.email, email));
    if (existing) {
      res.status(409).json({ error: "Email already registered" });
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

router.post("/auth/login", async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      res.status(400).json({ error: "Missing required fields" });
      return;
    }
    const [user] = await db.select().from(usersTable).where(eq(usersTable.email, email));
    if (!user || !user.passwordHash) {
      res.status(401).json({ error: "Invalid credentials" });
      return;
    }
    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) {
      res.status(401).json({ error: "Invalid credentials" });
      return;
    }
    const token = signToken({ id: user.id, email: user.email, role: user.role });
    res.json({ user: toUser(user), token });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Login failed" });
  }
});

router.post("/auth/logout", (req, res) => {
  res.json({ success: true, message: "Logged out" });
});

router.get("/auth/me", requireAuth, async (req, res) => {
  try {
    const userId = (req as any).user.id;
    const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId));
    if (!user) { res.status(404).json({ error: "User not found" }); return; }
    res.json(toUser(user));
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Failed" });
  }
});

router.get("/users", async (req, res) => {
  try {
    const { page = 1, limit = 20 } = req.query;
    const offset = (Number(page) - 1) * Number(limit);
    const [users, totalResult] = await Promise.all([
      db.select({ id: usersTable.id, email: usersTable.email, name: usersTable.name, avatar: usersTable.avatar, role: usersTable.role, createdAt: usersTable.createdAt })
        .from(usersTable).limit(Number(limit)).offset(offset),
      db.select().from(usersTable),
    ]);
    res.json({
      users: users.map(toUser),
      total: totalResult.length,
      page: Number(page),
      limit: Number(limit),
    });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Failed" });
  }
});

router.put("/users/profile", requireAuth, async (req, res) => {
  try {
    const userId = (req as any).user.id;
    const { name, avatar } = req.body;
    const [user] = await db.update(usersTable).set({ name, avatar }).where(eq(usersTable.id, userId)).returning();
    res.json(toUser(user));
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Failed" });
  }
});

router.post("/auth/change-password", requireAuth, async (req, res) => {
  try {
    const userId = (req as any).user.id;
    const { currentPassword, newPassword } = req.body;
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ error: "Current and new passwords are required." });
    }
    if (newPassword.length < 8) {
      return res.status(400).json({ error: "New password must be at least 8 characters." });
    }
    const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId));
    if (!user || !user.passwordHash) {
      return res.status(400).json({ error: "Cannot change password for this account." });
    }
    const valid = await comparePassword(currentPassword, user.passwordHash);
    if (!valid) {
      return res.status(401).json({ error: "Current password is incorrect." });
    }
    const hashed = await hashPassword(newPassword);
    await db.update(usersTable).set({ passwordHash: hashed }).where(eq(usersTable.id, userId));
    res.json({ success: true, message: "Password updated successfully." });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Failed to change password." });
  }
});


router.post("/auth/google", async (req, res) => {
  try {
    const { access_token } = req.body;
    if (!access_token) {
      res.status(400).json({ error: "Missing access_token" });
      return;
    }
    const googleRes = await fetch(`https://www.googleapis.com/oauth2/v1/userinfo?access_token=${access_token}`);
    if (!googleRes.ok) {
      res.status(401).json({ error: "Invalid Google token" });
      return;
    }
    const googleUser = await googleRes.json() as { id: string; email: string; name: string; picture: string };
    if (!googleUser.email) {
      res.status(400).json({ error: "Could not retrieve email from Google" });
      return;
    }
    let [user] = await db.select().from(usersTable).where(eq(usersTable.email, googleUser.email));
    if (!user) {
      [user] = await db.insert(usersTable).values({
        email: googleUser.email,
        name: googleUser.name || googleUser.email.split("@")[0],
        avatar: googleUser.picture || null,
        role: "user",
        passwordHash: null,
      }).returning();
    } else if (googleUser.picture && !user.avatar) {
      [user] = await db.update(usersTable).set({ avatar: googleUser.picture }).where(eq(usersTable.id, user.id)).returning();
    }
    const token = signToken({ id: user.id, email: user.email, role: user.role });
    res.json({ user: toUser(user), token });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Google authentication failed" });
  }
});


// Admin: update a user's role
router.patch("/admin/users/:id/role", requireAdmin, async (req, res) => {
  try {
    const userId = parseInt(req.params.id);
    const { role } = req.body;
    if (!["user", "admin"].includes(role)) {
      res.status(400).json({ error: "Invalid role. Must be 'user' or 'admin'." });
      return;
    }
    const [updated] = await db
      .update(usersTable)
      .set({ role })
      .where(eq(usersTable.id, userId))
      .returning();
    if (!updated) {
      res.status(404).json({ error: "User not found" });
      return;
    }
    res.json(toUser(updated));
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Failed to update role" });
  }
});


// Admin: delete a user
router.delete("/admin/users/:id", requireAdmin, async (req, res) => {
  try {
    const userId = parseInt(req.params.id);
    const requesterId = (req as any).user?.id;
    if (userId === requesterId) {
      res.status(400).json({ error: "Cannot delete your own account" });
      return;
    }
    const [deleted] = await db.delete(usersTable).where(eq(usersTable.id, userId)).returning();
    if (!deleted) { res.status(404).json({ error: "User not found" }); return; }
    res.json({ success: true });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Failed to delete user" });
  }
});

export default router;


