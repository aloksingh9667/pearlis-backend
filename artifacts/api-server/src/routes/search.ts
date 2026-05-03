import { Router } from "express";
import { db } from "@workspace/db";
import { productsTable } from "@workspace/db";
import { ilike, or } from "drizzle-orm";

const router = Router();

function toProduct(p: any) {
  return {
    id: p.id, name: p.name, slug: p.slug, description: p.description,
    price: parseFloat(p.price),
    discountPrice: p.discountPrice ? parseFloat(p.discountPrice) : null,
    category: p.category, categoryId: p.categoryId, material: p.material,
    images: p.images || [], stock: p.stock, isNew: p.isNew, isTrending: p.isTrending,
    isFeatured: p.isFeatured, rating: parseFloat(p.rating || "0"),
    reviewCount: p.reviewCount, tags: p.tags || [], createdAt: p.createdAt?.toISOString(),
  };
}

router.get("/search", async (req, res) => {
  try {
    const q = req.query.q as string;
    const limit = parseInt(req.query.limit as string || "8");
    if (!q) { res.json({ products: [], total: 0, suggestions: [] }); return; }

    const products = await db.select().from(productsTable).where(
      or(
        ilike(productsTable.name, `%${q}%`),
        ilike(productsTable.category, `%${q}%`),
        ilike(productsTable.material, `%${q}%`),
      )
    ).limit(limit);

    const suggestions = [...new Set(products.map((p) => p.name))].slice(0, 5);

    res.json({
      products: products.map(toProduct),
      total: products.length,
      suggestions,
    });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Failed to search" });
  }
});

export default router;
