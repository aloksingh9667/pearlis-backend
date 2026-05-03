import { Router } from "express";
import { db } from "@workspace/db";
import { blogsTable } from "@workspace/db";
import { eq, desc, sql } from "drizzle-orm";
import { requireAdmin } from "../lib/auth";

const router = Router();

function safeArr(v: any): any[] {
  if (Array.isArray(v)) return v;
  if (typeof v === "string" && v) {
    try { const p = JSON.parse(v); return Array.isArray(p) ? p : []; } catch { return []; }
  }
  return [];
}

function toBlog(b: any) {
  return {
    id: b.id, title: b.title, slug: b.slug, excerpt: b.excerpt,
    content: b.content, imageUrl: b.imageUrl, author: b.author,
    tags: safeArr(b.tags), createdAt: b.createdAt?.toISOString(),
  };
}

router.get("/blogs", async (req, res) => {
  try {
    const { page = 1, limit = 9 } = req.query;
    const offset = (Number(page) - 1) * Number(limit);
    const [blogs, countResult] = await Promise.all([
      db.select().from(blogsTable).orderBy(desc(blogsTable.createdAt)).limit(Number(limit)).offset(offset),
      db.select({ count: sql<number>`count(*)` }).from(blogsTable),
    ]);
    res.json({
      blogs: blogs.map(toBlog),
      total: Number(countResult[0]?.count || 0),
      page: Number(page),
      limit: Number(limit),
    });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Failed" });
  }
});

router.get("/blogs/:id", async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const [blog] = await db.select().from(blogsTable).where(eq(blogsTable.id, id));
    if (!blog) { res.status(404).json({ error: "Not found" }); return; }
    res.json(toBlog(blog));
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Failed" });
  }
});

router.post("/blogs", requireAdmin, async (req, res) => {
  try {
    const body = req.body;
    const slug = body.title.toLowerCase().replace(/\s+/g, "-") + "-" + Date.now();
    const [blog] = await db.insert(blogsTable).values({
      title: body.title, slug, excerpt: body.excerpt, content: body.content,
      imageUrl: body.imageUrl, author: body.author, tags: body.tags || [],
    }).returning();
    res.status(201).json(toBlog(blog));
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Failed to create blog" });
  }
});

router.put("/blogs/:id", requireAdmin, async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const body = req.body;
    const [blog] = await db.update(blogsTable).set({
      title: body.title, excerpt: body.excerpt, content: body.content,
      imageUrl: body.imageUrl, author: body.author, tags: body.tags || [],
    }).where(eq(blogsTable.id, id)).returning();
    if (!blog) { res.status(404).json({ error: "Not found" }); return; }
    res.json(toBlog(blog));
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Failed to update blog" });
  }
});

router.delete("/blogs/:id", requireAdmin, async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    await db.delete(blogsTable).where(eq(blogsTable.id, id));
    res.json({ success: true, message: "Deleted" });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Failed to delete blog" });
  }
});

export default router;
