import { Router } from "express";
import { db } from "@workspace/db";
import { siteSettingsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { requireAdmin } from "../lib/auth";

const router = Router();

// Default settings seeded on first request
const DEFAULT_SETTINGS: Record<string, any> = {
  branding: {
    siteName: "Pearlis",
    tagline: "Fine Jewellery",
    logoUrl: "",
    faviconUrl: "",
  },
  general: {
    siteName: "Pearlis",
    tagline: "Fine Jewellery",
    currency: "INR",
    currencySymbol: "₹",
    conversionRate: 83,
  },
  announcement: {
    enabled: true,
    text: "FREE SHIPPING ABOVE ₹5,000 | CODE PEARLIS10 FOR 10% OFF",
    link: "/shop",
  },
  payment: {
    codEnabled: true,
    razorpayEnabled: false,
    razorpayMode: "test",
    razorpayKeyId: "",
    razorpayTestKeyId: "",
  },
  keepAlive: {
    enabled: false,
    intervalMinutes: 14,
    pingUrl: "",
  },
  lowStockAlert: {
    enabled: false,
    threshold: 5,
    email: "",
  },
  contact: {
    email: "concierge@pearlis.com",
    phone: "+91 98765 43210",
    address: "124 Luxury Lane, Mumbai, Maharashtra 400001, India",
    hours: "Mon-Sat 10am-7pm IST",
    whatsapp: "+91 98765 43210",
  },
  social: {
    instagram: "https://instagram.com/pearlisjewels",
    facebook: "https://facebook.com/pearlisjewels",
    twitter: "https://twitter.com/pearlisjewels",
    pinterest: "https://pinterest.com/pearlisjewels",
    youtube: "",
  },
  instagram: {
    enabled: true,
    username: "pearlisjewels",
    posts: [] as string[],
  },
  videos: [] as Array<{ title: string; url: string; thumbnail: string }>,
  atelierVideo: "",
  flashSale: {
    enabled: false,
    title: "Flash Sale",
    subtitle: "Up to 30% Off",
    promoText: "Today Only — Use code PEARLIS10 at checkout",
    endsAt: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString(),
    code: "PEARLIS10",
    ctaText: "Shop the Sale",
    ctaLink: "/shop",
  },
  homeSale: {
    enabled: true,
    badge: "Limited Time Offer",
    offerLine: "Flat 20% OFF",
    subtitle: "Today Only",
    promoText: "Use code PEARLIS10 at checkout and save on our finest pieces.",
    code: "PEARLIS10",
    ctaText: "Shop the Sale",
    ctaLink: "/shop",
    endsAt: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString(),
  },
  shopFilters: {
    priceRanges: [
      { label: "Under ₹5,000", minINR: 0, maxINR: 5000 },
      { label: "₹5,000 – ₹15,000", minINR: 5000, maxINR: 15000 },
      { label: "₹15,000 – ₹50,000", minINR: 15000, maxINR: 50000 },
      { label: "₹50,000 – ₹1,00,000", minINR: 50000, maxINR: 100000 },
      { label: "Above ₹1,00,000", minINR: 100000, maxINR: 9999999 },
    ],
    materials: ["Gold", "Silver", "Platinum", "Rose Gold", "Diamond", "Pearl", "Gemstone"],
  },
  navbarCategories: {
    excludedSlugs: [] as string[],
  },
  sizeGuide: {
    ringTip: "Wrap a thin strip of paper around your finger, mark where it overlaps, and measure the length in mm. Match it to the circumference column below.",
    ringWarnTip: "Measure at the end of the day when fingers are at their largest. If between sizes, choose the larger size.",
    braceletTip: "Use a soft measuring tape or a strip of paper to measure around your wrist just below the wrist bone. Add 1–2 cm for a comfortable fit.",
    braceletWarnTip: "For bangles, measure the widest part of your hand (knuckles) when fingers are pressed together.",
    necklaceTip: "Necklace length is measured from end to end including the clasp. The style it creates depends on your neckline and body type.",
    ringRows: [
      { in: "5",  us: "5",  mm: "49.3", inch: "1.94\"" },
      { in: "6",  us: "6",  mm: "51.9", inch: "2.04\"" },
      { in: "7",  us: "7",  mm: "54.4", inch: "2.14\"" },
      { in: "8",  us: "8",  mm: "57.0", inch: "2.24\"" },
      { in: "9",  us: "9",  mm: "59.5", inch: "2.34\"" },
      { in: "10", us: "10", mm: "62.1", inch: "2.44\"" },
      { in: "11", us: "11", mm: "64.6", inch: "2.54\"" },
      { in: "12", us: "12", mm: "67.2", inch: "2.65\"" },
    ],
    braceletRows: [
      { label: "XS",  wrist: "13–14 cm", fit: "Snug fit" },
      { label: "S",   wrist: "15–16 cm", fit: "Regular fit" },
      { label: "M",   wrist: "16–17 cm", fit: "Regular fit" },
      { label: "L",   wrist: "17–18 cm", fit: "Relaxed fit" },
      { label: "XL",  wrist: "18–19 cm", fit: "Relaxed fit" },
      { label: "XXL", wrist: "19–21 cm", fit: "Loose fit" },
    ],
    necklaceRows: [
      { length: "14\" / 35 cm", style: "Choker",   description: "Sits at base of neck" },
      { length: "16\" / 40 cm", style: "Collar",   description: "Just below collarbone" },
      { length: "18\" / 45 cm", style: "Princess", description: "Most popular length" },
      { length: "20\" / 50 cm", style: "Matinee",  description: "Hits top of chest" },
      { length: "24\" / 60 cm", style: "Opera",    description: "Mid-chest drape" },
      { length: "30\" / 76 cm", style: "Rope",     description: "Below bust line" },
    ],
  },
};

async function ensureSettings() {
  for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
    const existing = await db.select().from(siteSettingsTable).where(eq(siteSettingsTable.key, key));
    if (existing.length === 0) {
      await db.insert(siteSettingsTable).values({ key, value });
    }
  }
}

// GET all settings (public)
router.get("/settings", async (req, res) => {
  try {
    await ensureSettings();
    const settings = await db.select().from(siteSettingsTable);
    const result: Record<string, any> = {};
    for (const s of settings) {
      result[s.key] = s.value;
    }
    res.json(result);
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Failed to get settings" });
  }
});

// GET single setting by key (public)
router.get("/settings/:key", async (req, res) => {
  try {
    const [setting] = await db.select().from(siteSettingsTable).where(eq(siteSettingsTable.key, req.params.key));
    if (!setting) {
      const defaultVal = DEFAULT_SETTINGS[req.params.key];
      if (defaultVal !== undefined) {
        res.json({ key: req.params.key, value: defaultVal });
        return;
      }
      res.status(404).json({ error: "Setting not found" });
      return;
    }
    res.json({ key: setting.key, value: setting.value });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Failed" });
  }
});

// PUT single setting (admin only)
router.put("/settings/:key", requireAdmin, async (req, res) => {
  try {
    const { value } = req.body;
    const existing = await db.select().from(siteSettingsTable).where(eq(siteSettingsTable.key, req.params.key));
    if (existing.length === 0) {
      const [setting] = await db.insert(siteSettingsTable).values({
        key: req.params.key,
        value,
      }).returning();
      res.json({ key: setting.key, value: setting.value });
    } else {
      const [setting] = await db.update(siteSettingsTable)
        .set({ value, updatedAt: new Date() })
        .where(eq(siteSettingsTable.key, req.params.key))
        .returning();
      res.json({ key: setting.key, value: setting.value });
    }
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Failed to update setting" });
  }
});

export default router;
