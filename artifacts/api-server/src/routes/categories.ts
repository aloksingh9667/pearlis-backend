import { Router } from "express";
import { db } from "@workspace/db";
import { categoriesTable, productsTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import { requireAdmin } from "../lib/auth";

const router = Router();

function toCategory(c: any) {
  return {
    id: c.id,
    name: c.name,
    slug: c.slug,
    imageUrl: c.imageUrl,
    description: c.description,
    productCount: c.productCount || 0,
  };
}

router.get("/categories", async (req, res) => {
  try {
    const categories = await db.select().from(categoriesTable);
    res.json(categories.map(toCategory));
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Failed" });
  }
});

router.post("/categories", requireAdmin, async (req, res) => {
  try {
    const body = req.body;
    const [category] = await db.insert(categoriesTable).values({
      name: body.name, slug: body.slug,
      imageUrl: body.imageUrl, description: body.description,
    }).returning();
    res.status(201).json(toCategory(category));
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Failed to create category" });
  }
});

router.put("/categories/:id", requireAdmin, async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const body = req.body;
    const [category] = await db.update(categoriesTable).set({
      name: body.name, slug: body.slug,
      imageUrl: body.imageUrl, description: body.description,
    }).where(eq(categoriesTable.id, id)).returning();
    if (!category) { res.status(404).json({ error: "Not found" }); return; }
    res.json(toCategory(category));
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Failed to update category" });
  }
});

router.delete("/categories/:id", requireAdmin, async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    await db.delete(categoriesTable).where(eq(categoriesTable.id, id));
    res.json({ success: true, message: "Category deleted" });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Failed to delete category" });
  }
});

export default router;
