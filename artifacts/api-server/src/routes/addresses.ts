import { Router } from "express";
import { db } from "@workspace/db";
import { addressesTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { requireAuth } from "../lib/auth";

const router = Router();

function toAddress(a: any) {
  return {
    id: a.id,
    name: a.name,
    line1: a.line1,
    line2: a.line2,
    city: a.city,
    state: a.state,
    postalCode: a.postalCode,
    country: a.country,
    phone: a.phone,
    isDefault: a.isDefault,
  };
}

router.get("/users/addresses", requireAuth, async (req, res) => {
  try {
    const userId = (req as any).user.id;
    const addresses = await db.select().from(addressesTable).where(eq(addressesTable.userId, userId));
    res.json(addresses.map(toAddress));
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Failed" });
  }
});

router.post("/users/addresses", requireAuth, async (req, res) => {
  try {
    const userId = (req as any).user.id;
    const body = req.body;
    /* if this is being set as default, unset all others first */
    if (body.isDefault) {
      await db.update(addressesTable).set({ isDefault: false }).where(eq(addressesTable.userId, userId));
    }
    const [address] = await db.insert(addressesTable).values({
      userId, name: body.name, line1: body.line1, line2: body.line2,
      city: body.city, state: body.state, postalCode: body.postalCode,
      country: body.country, phone: body.phone, isDefault: body.isDefault ?? false,
    }).returning();
    res.status(201).json(toAddress(address));
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Failed" });
  }
});

router.patch("/users/addresses/:id", requireAuth, async (req, res) => {
  try {
    const userId = (req as any).user.id;
    const id = parseInt(req.params.id);
    const body = req.body;
    /* if setting as default, clear all other defaults first */
    if (body.isDefault) {
      await db.update(addressesTable).set({ isDefault: false }).where(eq(addressesTable.userId, userId));
    }
    const [updated] = await db
      .update(addressesTable)
      .set({
        ...(body.name !== undefined && { name: body.name }),
        ...(body.line1 !== undefined && { line1: body.line1 }),
        ...(body.line2 !== undefined && { line2: body.line2 }),
        ...(body.city !== undefined && { city: body.city }),
        ...(body.state !== undefined && { state: body.state }),
        ...(body.postalCode !== undefined && { postalCode: body.postalCode }),
        ...(body.country !== undefined && { country: body.country }),
        ...(body.phone !== undefined && { phone: body.phone }),
        ...(body.isDefault !== undefined && { isDefault: body.isDefault }),
      })
      .where(and(eq(addressesTable.id, id), eq(addressesTable.userId, userId)))
      .returning();
    if (!updated) return res.status(404).json({ error: "Not found" });
    res.json(toAddress(updated));
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Failed to update address" });
  }
});

router.delete("/users/addresses/:id", requireAuth, async (req, res) => {
  try {
    const userId = (req as any).user.id;
    const id = parseInt(req.params.id);
    await db.delete(addressesTable).where(and(eq(addressesTable.id, id), eq(addressesTable.userId, userId)));
    res.json({ success: true });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Failed" });
  }
});

export default router;
