import { Router } from "express";
import { db } from "@workspace/db";
import { cartItemsTable, productsTable, couponsTable } from "@workspace/db";
import { eq, and, inArray } from "drizzle-orm";
import { optionalAuth, getSessionId } from "../lib/auth";

const router = Router();

async function buildCart(sessionId: string) {
  const items = await db.select().from(cartItemsTable).where(eq(cartItemsTable.sessionId, sessionId));
  const productIds = items.map((i) => i.productId);

  if (productIds.length === 0) {
    return { items: [], subtotal: 0, discount: 0, total: 0, couponCode: null };
  }

  const products = await db.select().from(productsTable).where(
    productIds.length === 1
      ? eq(productsTable.id, productIds[0])
      : inArray(productsTable.id, productIds)
  );

  const productMap = new Map(products.map((p) => [p.id, p]));
  const cartItems = items.map((item) => {
    const product = productMap.get(item.productId);
    if (!product) return null;
    return {
      productId: item.productId,
      quantity: item.quantity,
      product: {
        id: product.id,
        name: product.name,
        slug: product.slug,
        description: product.description,
        price: parseFloat(product.price),
        discountPrice: product.discountPrice ? parseFloat(product.discountPrice) : null,
        category: product.category,
        categoryId: product.categoryId,
        material: product.material,
        images: product.images || [],
        stock: product.stock,
        isNew: product.isNew,
        isTrending: product.isTrending,
        isFeatured: product.isFeatured,
        rating: parseFloat(product.rating || "0"),
        reviewCount: product.reviewCount,
        tags: product.tags || [],
        createdAt: product.createdAt?.toISOString(),
      },
    };
  }).filter(Boolean);

  const subtotal = cartItems.reduce((sum, item) => {
    if (!item) return sum;
    const price = item.product.discountPrice ?? item.product.price;
    return sum + price * item.quantity;
  }, 0);

  return { items: cartItems, subtotal, discount: 0, total: subtotal, couponCode: null };
}

router.use(optionalAuth);

router.get("/cart", async (req, res) => {
  try {
    const sessionId = getSessionId(req);
    const cart = await buildCart(sessionId);
    res.json(cart);
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Failed to get cart" });
  }
});

router.post("/cart/items", async (req, res) => {
  try {
    const sessionId = getSessionId(req);
    const { productId, quantity } = req.body;

    const [existing] = await db.select().from(cartItemsTable)
      .where(and(eq(cartItemsTable.sessionId, sessionId), eq(cartItemsTable.productId, productId)));

    if (existing) {
      await db.update(cartItemsTable).set({ quantity: existing.quantity + quantity })
        .where(eq(cartItemsTable.id, existing.id));
    } else {
      await db.insert(cartItemsTable).values({ sessionId, productId, quantity });
    }

    const cart = await buildCart(sessionId);
    res.json(cart);
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Failed to add to cart" });
  }
});

router.put("/cart/items/:productId", async (req, res) => {
  try {
    const sessionId = getSessionId(req);
    const productId = parseInt(req.params.productId);
    const { quantity } = req.body;

    if (quantity <= 0) {
      await db.delete(cartItemsTable)
        .where(and(eq(cartItemsTable.sessionId, sessionId), eq(cartItemsTable.productId, productId)));
    } else {
      await db.update(cartItemsTable).set({ quantity })
        .where(and(eq(cartItemsTable.sessionId, sessionId), eq(cartItemsTable.productId, productId)));
    }

    const cart = await buildCart(sessionId);
    res.json(cart);
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Failed to update cart item" });
  }
});

router.delete("/cart/items/:productId", async (req, res) => {
  try {
    const sessionId = getSessionId(req);
    const productId = parseInt(req.params.productId);
    await db.delete(cartItemsTable)
      .where(and(eq(cartItemsTable.sessionId, sessionId), eq(cartItemsTable.productId, productId)));
    const cart = await buildCart(sessionId);
    res.json(cart);
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Failed to remove from cart" });
  }
});

router.delete("/cart/clear", async (req, res) => {
  try {
    const sessionId = getSessionId(req);
    await db.delete(cartItemsTable).where(eq(cartItemsTable.sessionId, sessionId));
    res.json({ success: true, message: "Cart cleared" });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Failed to clear cart" });
  }
});

router.post("/cart/coupon", async (req, res) => {
  try {
    const { code } = req.body;
    const [coupon] = await db.select().from(couponsTable).where(eq(couponsTable.code, code.toUpperCase()));
    if (!coupon || !coupon.isActive) {
      res.json({ valid: false, discount: 0, message: "Invalid or expired coupon" });
      return;
    }
    if (coupon.expiresAt && new Date(coupon.expiresAt) < new Date()) {
      res.json({ valid: false, discount: 0, message: "Coupon has expired" });
      return;
    }
    res.json({ valid: true, discount: parseFloat(coupon.discountValue), message: "Coupon applied" });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Failed to apply coupon" });
  }
});

export default router;
