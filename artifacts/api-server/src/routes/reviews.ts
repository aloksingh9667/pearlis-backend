import { Router } from "express";
import { db } from "@workspace/db";
import { reviewsTable, productsTable } from "@workspace/db";
import { eq, avg, count, desc } from "drizzle-orm";

const router = Router();

function toReview(r: any) {
  return {
    id: r.id,
    productId: r.productId,
    productName: r.productName,
    userId: r.userId,
    userName: r.userName,
    rating: r.rating,
    comment: r.comment,
    isApproved: r.isApproved,
    createdAt: r.createdAt?.toISOString(),
  };
}

/* ── Public: get approved reviews for a product ── */
router.get("/products/:id/reviews", async (req, res) => {
  try {
    const productId = parseInt(req.params.id);
    const reviews = await db
      .select()
      .from(reviewsTable)
      .where(eq(reviewsTable.productId, productId))
      .orderBy(desc(reviewsTable.createdAt));
    res.json(reviews.filter(r => r.isApproved).map(toReview));
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Failed" });
  }
});

/* ── Public: submit a review ── */
router.post("/products/:id/reviews", async (req, res) => {
  try {
    const productId = parseInt(req.params.id);
    const { rating, comment, userName } = req.body;
    if (!rating || rating < 1 || rating > 5) {
      return res.status(400).json({ error: "Rating must be 1–5" });
    }
    if (!comment?.trim()) {
      return res.status(400).json({ error: "Comment is required" });
    }
    const [review] = await db.insert(reviewsTable).values({
      productId,
      rating: parseInt(rating),
      comment: comment.trim(),
      userName: (userName || "Anonymous").trim(),
      isApproved: true,
    }).returning();

    await recalcProduct(productId);
    res.status(201).json(toReview(review));
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Failed to create review" });
  }
});

/* ── Admin: list all reviews (all products) ── */
router.get("/admin/reviews", async (req, res) => {
  const user = (req as any).user;
  if (!user || user.role !== "admin") return res.status(403).json({ error: "Forbidden" });
  try {
    const rows = await db
      .select({
        id: reviewsTable.id,
        productId: reviewsTable.productId,
        productName: productsTable.name,
        userId: reviewsTable.userId,
        userName: reviewsTable.userName,
        rating: reviewsTable.rating,
        comment: reviewsTable.comment,
        isApproved: reviewsTable.isApproved,
        createdAt: reviewsTable.createdAt,
      })
      .from(reviewsTable)
      .leftJoin(productsTable, eq(reviewsTable.productId, productsTable.id))
      .orderBy(desc(reviewsTable.createdAt));
    res.json(rows.map(toReview));
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Failed" });
  }
});

/* ── Admin: approve a review ── */
router.patch("/admin/reviews/:id/approve", async (req, res) => {
  const user = (req as any).user;
  if (!user || user.role !== "admin") return res.status(403).json({ error: "Forbidden" });
  try {
    const [updated] = await db
      .update(reviewsTable)
      .set({ isApproved: true })
      .where(eq(reviewsTable.id, parseInt(req.params.id)))
      .returning();
    if (!updated) return res.status(404).json({ error: "Not found" });
    if (updated.productId) await recalcProduct(updated.productId);
    res.json(toReview(updated));
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Failed" });
  }
});

/* ── Admin: reject/hide a review ── */
router.patch("/admin/reviews/:id/reject", async (req, res) => {
  const user = (req as any).user;
  if (!user || user.role !== "admin") return res.status(403).json({ error: "Forbidden" });
  try {
    const [updated] = await db
      .update(reviewsTable)
      .set({ isApproved: false })
      .where(eq(reviewsTable.id, parseInt(req.params.id)))
      .returning();
    if (!updated) return res.status(404).json({ error: "Not found" });
    if (updated.productId) await recalcProduct(updated.productId);
    res.json(toReview(updated));
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Failed" });
  }
});

/* ── Admin: delete a review ── */
router.delete("/admin/reviews/:id", async (req, res) => {
  const user = (req as any).user;
  if (!user || user.role !== "admin") return res.status(403).json({ error: "Forbidden" });
  try {
    const [deleted] = await db
      .delete(reviewsTable)
      .where(eq(reviewsTable.id, parseInt(req.params.id)))
      .returning();
    if (!deleted) return res.status(404).json({ error: "Not found" });
    if (deleted.productId) await recalcProduct(deleted.productId);
    res.json({ success: true });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Failed" });
  }
});

async function recalcProduct(productId: number) {
  const [stats] = await db
    .select({ avgRating: avg(reviewsTable.rating), reviewCount: count(reviewsTable.id) })
    .from(reviewsTable)
    .where(eq(reviewsTable.productId, productId));
  if (stats) {
    await db.update(productsTable).set({
      rating: parseFloat(stats.avgRating || "0").toFixed(2),
      reviewCount: Number(stats.reviewCount),
    }).where(eq(productsTable.id, productId));
  }
}

export default router;
