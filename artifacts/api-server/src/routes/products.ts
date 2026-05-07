import { Router } from "express";
import { db } from "@workspace/db";
import { productsTable, categoriesTable, siteSettingsTable, reviewsTable, stockAlertsTable, wishlistTable } from "@workspace/db";
import { eq, ilike, and, gte, lte, desc, asc, sql } from "drizzle-orm";
import { requireAdmin } from "../lib/auth";
import { triggerStockAlerts } from "./stock-alerts";
import { sendLowStockAdminAlertEmail } from "../lib/mailgun";

async function checkAndSendLowStockAlert(productId: number, productName: string, newStock: number) {
  try {
    const [setting] = await db.select().from(siteSettingsTable).where(eq(siteSettingsTable.key, "lowStockAlert"));
    const cfg = (setting?.value as any) ?? {};
    if (!cfg.enabled || !cfg.email || cfg.threshold == null) return;
    if (newStock > cfg.threshold) return;
    const appUrl = process.env.APP_URL || "https://pearlis.in";
    await sendLowStockAdminAlertEmail(cfg.email, [{ name: productName, stock: newStock, id: productId }], appUrl);
  } catch {}
}

/* ── Stock History ── */
let _stockHistoryReady = false;
async function ensureStockHistoryTable() {
  if (_stockHistoryReady) return;
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS stock_history (
      id SERIAL PRIMARY KEY,
      product_id INTEGER NOT NULL,
      previous_stock INTEGER NOT NULL,
      new_stock INTEGER NOT NULL,
      change INTEGER NOT NULL,
      reason TEXT NOT NULL,
      order_id INTEGER,
      note TEXT,
      created_at TIMESTAMP DEFAULT NOW() NOT NULL
    )
  `);
  _stockHistoryReady = true;
}

async function logStockChange(
  productId: number,
  previousStock: number,
  newStock: number,
  reason: "initial" | "manual_edit" | "order_placed",
  orderId?: number,
  note?: string,
) {
  try {
    await ensureStockHistoryTable();
    const change = newStock - previousStock;
    await db.execute(sql`
      INSERT INTO stock_history (product_id, previous_stock, new_stock, change, reason, order_id, note)
      VALUES (${productId}, ${previousStock}, ${newStock}, ${change}, ${reason}, ${orderId ?? null}, ${note ?? null})
    `);
  } catch {}
}

const router = Router();

function safeArr(v: any): any[] {
  if (Array.isArray(v)) return v;
  if (typeof v === "string" && v) {
    try { const p = JSON.parse(v); return Array.isArray(p) ? p : []; } catch { return []; }
  }
  return [];
}

function toProduct(p: any) {
  return {
    id: p.id,
    name: p.name,
    slug: p.slug,
    description: p.description,
    price: parseFloat(p.price),
    discountPrice: p.discountPrice ? parseFloat(p.discountPrice) : null,
    category: p.category,
    categoryId: p.categoryId,
    material: p.material,
    images: safeArr(p.images),
    videoUrl: p.videoUrl || null,
    stock: p.stock,
    isNew: p.isNew,
    isTrending: p.isTrending,
    isFeatured: p.isFeatured,
    rating: parseFloat(p.rating || "0"),
    reviewCount: p.reviewCount,
    tags: safeArr(p.tags),
    specifications: safeArr(p.specifications),
    craftStory: p.craftStory || null,
    craftPoints: safeArr(p.craftPoints),
    shippingInfo: p.shippingInfo || null,
    sizes: safeArr(p.sizes),
    materialVariants: safeArr(p.materialVariants),
    createdAt: p.createdAt?.toISOString(),
  };
}

router.get("/products", async (req, res) => {
  try {
    const { category, material, minPrice, maxPrice, sort, page = 1, limit = 12, search } = req.query;
    const conditions: any[] = [];

    if (category) conditions.push(eq(productsTable.category, category as string));
    if (material) conditions.push(eq(productsTable.material, material as string));
    if (minPrice) conditions.push(gte(productsTable.price, minPrice as string));
    if (maxPrice) conditions.push(lte(productsTable.price, maxPrice as string));
    if (search) {
      conditions.push(ilike(productsTable.name, `%${search}%`));
    }

    const where = conditions.length > 0 ? and(...conditions) : undefined;

    let orderBy: any = desc(productsTable.createdAt);
    if (sort === "price_asc") orderBy = asc(productsTable.price);
    else if (sort === "price_desc") orderBy = desc(productsTable.price);
    else if (sort === "trending") orderBy = desc(productsTable.isTrending);
    else if (sort === "rating") orderBy = desc(productsTable.rating);

    const offset = (Number(page) - 1) * Number(limit);
    const [products, totalResult] = await Promise.all([
      db.select().from(productsTable).where(where).orderBy(orderBy).limit(Number(limit)).offset(offset),
      db.select({ count: sql<number>`count(*)` }).from(productsTable).where(where),
    ]);

    res.json({
      products: products.map(toProduct),
      total: Number(totalResult[0]?.count || 0),
      page: Number(page),
      limit: Number(limit),
    });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Failed to list products" });
  }
});

router.get("/products/featured", async (req, res) => {
  try {
    const products = await db.select().from(productsTable).where(eq(productsTable.isFeatured, true)).limit(8);
    res.json(products.map(toProduct));
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Failed" });
  }
});

router.get("/products/trending", async (req, res) => {
  try {
    const products = await db.select().from(productsTable).where(eq(productsTable.isTrending, true)).orderBy(desc(productsTable.rating)).limit(8);
    res.json(products.map(toProduct));
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Failed" });
  }
});

router.get("/products/new-arrivals", async (req, res) => {
  try {
    const products = await db.select().from(productsTable).where(eq(productsTable.isNew, true)).orderBy(desc(productsTable.createdAt)).limit(8);
    res.json(products.map(toProduct));
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Failed" });
  }
});

router.get("/products/:id", async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const [product] = await db.select().from(productsTable).where(eq(productsTable.id, id));
    if (!product) { res.status(404).json({ error: "Not found" }); return; }
    res.json(toProduct(product));
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Failed" });
  }
});

router.get("/products/:id/related", async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const [product] = await db.select().from(productsTable).where(eq(productsTable.id, id));
    if (!product) { res.json([]); return; }
    const related = await db.select().from(productsTable)
      .where(and(eq(productsTable.category, product.category), sql`${productsTable.id} != ${id}`))
      .limit(4);
    res.json(related.map(toProduct));
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Failed" });
  }
});

router.get("/products/:id/stock-history", requireAdmin, async (req, res) => {
  try {
    await ensureStockHistoryTable();
    const id = parseInt(req.params.id);
    const result = await db.execute(sql`
      SELECT id, product_id, previous_stock, new_stock, change, reason, order_id, note, created_at
      FROM stock_history
      WHERE product_id = ${id}
      ORDER BY created_at DESC
      LIMIT 100
    `);
    res.json(result.rows);
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Failed to fetch stock history" });
  }
});

router.post("/products", requireAdmin, async (req, res) => {
  try {
    const body = req.body;
    const slug = body.name.toLowerCase().replace(/\s+/g, "-") + "-" + Date.now();
    const initialStock = body.stock || 0;
    const [product] = await db.insert(productsTable).values({
      name: body.name, slug, description: body.description,
      price: body.price.toString(), discountPrice: body.discountPrice?.toString() || null,
      category: body.category, categoryId: body.categoryId, material: body.material,
      images: body.images || [], videoUrl: body.videoUrl || null,
      stock: initialStock,
      isNew: body.isNew ?? false, isTrending: body.isTrending ?? false,
      isFeatured: body.isFeatured ?? false, tags: body.tags || [],
      specifications: body.specifications || [],
      craftStory: body.craftStory || null,
      craftPoints: body.craftPoints || [],
      shippingInfo: body.shippingInfo || null,
      sizes: body.sizes || [],
      materialVariants: body.materialVariants || [],
    }).returning();
    logStockChange(product.id, 0, initialStock, "initial", undefined, "Product created").catch(() => {});
    res.status(201).json(toProduct(product));
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Failed to create product" });
  }
});

router.put("/products/:id", requireAdmin, async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const body = req.body;
    /* snapshot old stock to detect back-in-stock and log changes */
    const [old] = await db.select({ stock: productsTable.stock }).from(productsTable).where(eq(productsTable.id, id));
    const oldStock = old?.stock ?? 0;
    const wasOutOfStock = oldStock === 0;

    const [product] = await db.update(productsTable).set({
      name: body.name, description: body.description,
      price: body.price?.toString(), discountPrice: body.discountPrice?.toString() || null,
      category: body.category, categoryId: body.categoryId, material: body.material,
      images: body.images, videoUrl: body.videoUrl || null,
      stock: body.stock,
      isNew: body.isNew, isTrending: body.isTrending, isFeatured: body.isFeatured,
      tags: body.tags,
      specifications: body.specifications || [],
      craftStory: body.craftStory || null,
      craftPoints: body.craftPoints || [],
      shippingInfo: body.shippingInfo || null,
      sizes: body.sizes || [],
      materialVariants: body.materialVariants || [],
    }).where(eq(productsTable.id, id)).returning();
    if (!product) { res.status(404).json({ error: "Not found" }); return; }

    /* log stock change if stock was modified */
    if (body.stock !== undefined && body.stock !== oldStock) {
      logStockChange(id, oldStock, body.stock, "manual_edit", undefined, "Admin updated product").catch(() => {});
    }

    /* fire-and-forget stock alert emails if product came back in stock */
    if (wasOutOfStock && body.stock > 0) {
      const appUrl = process.env.APP_URL || "https://pearlis.in";
      triggerStockAlerts(id, product.name, `${appUrl}/product/${id}`).catch(() => {});
    }

    /* fire-and-forget low stock admin alert if stock dropped to/below threshold */
    if (body.stock !== undefined) {
      checkAndSendLowStockAlert(id, product.name, body.stock).catch(() => {});
    }

    res.json(toProduct(product));
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Failed to update product" });
  }
});

router.delete("/products/:id", requireAdmin, async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    // Delete FK-dependent records first to avoid constraint violations
    await db.delete(reviewsTable).where(eq(reviewsTable.productId, id));
    await db.delete(stockAlertsTable).where(eq(stockAlertsTable.productId, id));
    await db.delete(wishlistTable).where(eq(wishlistTable.productId, id));
    await db.delete(productsTable).where(eq(productsTable.id, id));
    res.json({ success: true, message: "Product deleted" });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Failed to delete product" });
  }
});

export default router;
