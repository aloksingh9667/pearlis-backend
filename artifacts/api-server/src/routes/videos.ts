import { Router } from "express";
import { db } from "@workspace/db";
import { videosTable } from "@workspace/db";
import { eq, desc } from "drizzle-orm";
import { requireAdmin } from "../lib/auth";

const router = Router();

router.get("/videos", async (req, res) => {
  try {
    const { category, featured } = req.query;
    let query = db.select().from(videosTable).orderBy(desc(videosTable.createdAt));
    const rows = await query;
    let result = rows.filter(v => v.isPublished);
    if (category) result = result.filter(v => v.category === category);
    if (featured === "true") result = result.filter(v => v.isFeatured);
    res.json(result);
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Failed to fetch videos" });
  }
});

router.get("/videos/all", requireAdmin, async (req, res) => {
  try {
    const rows = await db.select().from(videosTable).orderBy(desc(videosTable.createdAt));
    res.json(rows);
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Failed to fetch videos" });
  }
});

router.get("/videos/:id", async (req, res) => {
  try {
    const id = parseInt(req.params.id as string);
    const [video] = await db.select().from(videosTable).where(eq(videosTable.id, id));
    if (!video) { res.status(404).json({ error: "Not found" }); return; }
    res.json(video);
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Failed to fetch video" });
  }
});

router.post("/videos", requireAdmin, async (req, res) => {
  try {
    const body = req.body;
    const [video] = await db.insert(videosTable).values({
      title: body.title,
      description: body.description || null,
      videoUrl: body.videoUrl,
      thumbnailUrl: body.thumbnailUrl || null,
      category: body.category || "lookbook",
      isFeatured: body.isFeatured ?? false,
      isPublished: body.isPublished ?? true,
    }).returning();
    res.status(201).json(video);
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Failed to create video" });
  }
});

router.put("/videos/:id", requireAdmin, async (req, res) => {
  try {
    const id = parseInt(req.params.id as string);
    const body = req.body;
    const [video] = await db.update(videosTable).set({
      title: body.title,
      description: body.description || null,
      videoUrl: body.videoUrl,
      thumbnailUrl: body.thumbnailUrl || null,
      category: body.category || "lookbook",
      isFeatured: body.isFeatured ?? false,
      isPublished: body.isPublished ?? true,
    }).where(eq(videosTable.id, id)).returning();
    if (!video) { res.status(404).json({ error: "Not found" }); return; }
    res.json(video);
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Failed to update video" });
  }
});

router.delete("/videos/:id", requireAdmin, async (req, res) => {
  try {
    const id = parseInt(req.params.id as string);
    await db.delete(videosTable).where(eq(videosTable.id, id));
    res.json({ success: true });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Failed to delete video" });
  }
});

export default router;
