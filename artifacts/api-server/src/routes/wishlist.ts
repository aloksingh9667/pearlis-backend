import { Router } from "express";
import { db } from "@workspace/db";
import { wishlistTable, productsTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { optionalAuth, getSessionId } from "../lib/auth";

const router = Router();
router.use(optionalAuth);

function toProduct(p: any) {
  return {
    id: p.id, name: p.name, slug: p.slug, description: p.description,
    price: parseFloat(p.price),
    discountPrice: p.discountPrice ? parseFloat(p.discountPrice) : null,
    category: p.category, categoryId: p.categoryId, material: p.material,
    images: p.images || [], stock: p.stock, isNew: p.isNew, isTrending: p.isTrending,
    isFeatured: p.isFeatured, rating: parseFloat(p.rating || "0"), reviewCount: p.reviewCount,
    tags: p.tags || [], createdAt: p.createdAt?.toISOString(),
  };
}

router.get("/wishlist", async (req, res) => {
  try {
    const sessionId = getSessionId(req);
    const items = await db.select().from(wishlistTable).where(eq(wishlistTable.sessionId, sessionId));
    if (items.length === 0) { res.json([]); return; }
    const productIds = items.map((i) => i.productId);
    const products = await db.select().from(productsTable);
    const filtered = products.filter((p) => productIds.includes(p.id));
    res.json(filtered.map(toProduct));
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Failed" });
  }
});

router.post("/wishlist/:productId", async (req, res) => {
  try {
    const sessionId = getSessionId(req);
    const productId = parseInt(req.params.productId);
    const [existing] = await db.select().from(wishlistTable)
      .where(and(eq(wishlistTable.sessionId, sessionId), eq(wishlistTable.productId, productId)));
    if (!existing) {
      await db.insert(wishlistTable).values({ sessionId, productId });
    }
    res.json({ success: true, message: "Added to wishlist" });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Failed" });
  }
});

router.delete("/wishlist/:productId", async (req, res) => {
  try {
    const sessionId = getSessionId(req);
    const productId = parseInt(req.params.productId);
    await db.delete(wishlistTable)
      .where(and(eq(wishlistTable.sessionId, sessionId), eq(wishlistTable.productId, productId)));
    res.json({ success: true, message: "Removed from wishlist" });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Failed" });
  }
});

export default router;
