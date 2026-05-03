import { Router } from "express";
import { db } from "@workspace/db";
import { usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { signToken } from "../lib/auth";

const router = Router();

function toUser(u: any) {
  return { id: u.id, email: u.email, name: u.name, avatar: u.avatar, role: u.role, createdAt: u.createdAt?.toISOString() };
}

router.post("/auth/google", async (req, res) => {
  try {
    const { access_token } = req.body;
    if (!access_token) {
      res.status(400).json({ error: "Missing Google access token" });
      return;
    }

    const googleRes = await fetch(`https://www.googleapis.com/oauth2/v3/userinfo`, {
      headers: { Authorization: `Bearer ${access_token}` },
    });

    if (!googleRes.ok) {
      res.status(401).json({ error: "Invalid Google token" });
      return;
    }

    const { email, name, picture } = await googleRes.json() as { email: string; name: string; picture: string };

    if (!email) {
      res.status(400).json({ error: "Could not retrieve email from Google" });
      return;
    }

    let [user] = await db.select().from(usersTable).where(eq(usersTable.email, email));

    if (!user) {
      [user] = await db.insert(usersTable).values({
        email,
        name: name || email.split("@")[0],
        avatar: picture || null,
        role: "user",
        passwordHash: null,
      }).returning();
    }

    const token = signToken({ id: user.id, email: user.email, role: user.role });
    res.json({ user: toUser(user), token });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Google authentication failed" });
  }
});

export default router;
