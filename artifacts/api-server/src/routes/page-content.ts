import { Router } from "express";
import { db } from "@workspace/db";
import { pageContentTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { requireAdmin } from "../lib/auth";

const router = Router();

const DEFAULT_PAGE_CONTENT: Record<string, any> = {
  home: {
    hero: {
      title: "Crafted for Eternity",
      subtitle: "Discover our exclusive collection of fine jewellery, where every piece tells a story of timeless elegance.",
      ctaText: "Explore Collection",
      videoUrl: "https://www.youtube.com/embed/dQw4w9WgXcQ",
      backgroundImage: "https://images.unsplash.com/photo-1515562141207-7a88fb7ce338?w=1920&q=80",
    },
    flashSale: {
      enabled: true,
      badge: "Limited Offer",
      title: "Flash Sale",
      subtitle: "Up to 30% off on select pieces",
      cta: "Shop Now",
      ctaLink: "/shop",
    },
    brandStory: {
      title: "A Legacy of Passion",
      subtitle: "Our Story",
      text: "Founded with a passion for exceptional craftsmanship, Pearlis has been creating heirloom-quality jewellery for over seven years. Each piece is a testament to our dedication to quality and artistry.",
      image: "https://images.unsplash.com/photo-1611591437281-460bfbe1220a?w=800&q=80",
      stats: [
        { value: "7+", label: "Years of Excellence" },
        { value: "50K+", label: "Happy Clients" },
        { value: "98%", label: "Satisfaction Rate" },
      ],
    },
    collections: [
      { title: "Rings", image: "https://images.unsplash.com/photo-1605100804763-247f67b3557e?w=800&q=80", link: "/category/rings" },
      { title: "Necklaces", image: "https://images.unsplash.com/photo-1599643478518-a784e5dc4c8f?w=400&q=80", link: "/category/necklaces" },
      { title: "Bracelets", image: "https://images.unsplash.com/photo-1611591437281-460bfbe1220a?w=400&q=80", link: "/category/bracelets" },
    ],
  },
  shop: {
    hero: {
      title: "The Collection",
      subtitle: "Explore our exceptional range of fine jewelry.",
    },
  },
  rings: {
    hero: {
      title: "Rings",
      subtitle: "From solitaire diamonds to intricate gold bands, find your perfect ring.",
      image: "https://images.unsplash.com/photo-1605100804763-247f67b3557e?w=1920&q=80",
    },
  },
  necklaces: {
    hero: {
      title: "Necklaces",
      subtitle: "Elevate every look with our handcrafted necklace collection.",
      image: "https://images.unsplash.com/photo-1599643478518-a784e5dc4c8f?w=1920&q=80",
    },
  },
  bracelets: {
    hero: {
      title: "Bracelets",
      subtitle: "Adorn your wrists with our exquisite bracelet collection.",
      image: "https://images.unsplash.com/photo-1611591437281-460bfbe1220a?w=1920&q=80",
    },
  },
  earrings: {
    hero: {
      title: "Earrings",
      subtitle: "Frame your face with our stunning earring collection.",
      image: "https://images.unsplash.com/photo-1535632066927-ab7c9ab60908?w=1920&q=80",
    },
  },
  gallery: {
    hero: {
      title: "The Gallery",
      subtitle: "A visual journey through the art of fine jewellery.",
    },
    videos: [] as Array<{ title: string; url: string; thumbnail: string }>,
  },
  blog: {
    hero: {
      title: "The Journal",
      subtitle: "Stories, insights and inspiration from the world of fine jewellery.",
    },
  },
  about: {
    hero: {
      title: "Our Story",
      subtitle: "A legacy built on passion, craftsmanship and timeless elegance.",
      image: "https://images.unsplash.com/photo-1515562141207-7a88fb7ce338?w=1920&q=80",
    },
    mission: {
      title: "Our Mission",
      text: "To create jewellery that transcends time — pieces that become part of your story and are passed down through generations.",
    },
    team: [
      { name: "Aisha Patel", role: "Founder & Creative Director", image: "" },
      { name: "Rahul Mehta", role: "Master Goldsmith", image: "" },
    ],
    values: [
      { title: "Craftsmanship", text: "Every piece is handcrafted by master artisans with decades of experience." },
      { title: "Quality", text: "We source only the finest ethically-sourced gemstones and precious metals." },
      { title: "Legacy", text: "Our jewellery is designed to be treasured and passed down for generations." },
    ],
  },
  contact: {
    address: "124 Luxury Lane, Mumbai, Maharashtra 400001, India",
    email: "concierge@pearlis.com",
    phone: "+91 98765 43210",
    whatsapp: "+91 98765 43210",
    hours: "Monday - Saturday: 10am - 7pm IST\nSunday: Closed",
    mapEmbed: "",
  },
};

// GET /page-content/:page — public
router.get("/page-content/:page", async (req, res) => {
  try {
    const page = req.params.page as string;
    const [row] = await db.select().from(pageContentTable).where(eq(pageContentTable.page, page));
    if (!row) {
      const defaultContent = DEFAULT_PAGE_CONTENT[page];
      if (defaultContent) {
        // Seed it
        const [newRow] = await db.insert(pageContentTable).values({ page, content: defaultContent }).returning();
        res.json({ page: newRow.page, content: newRow.content });
        return;
      }
      res.status(404).json({ error: "Page not found" });
      return;
    }
    res.json({ page: row.page, content: row.content });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Failed to get page content" });
  }
});

// GET /page-content — list all pages (admin only)
router.get("/page-content", requireAdmin, async (req, res) => {
  try {
    const rows = await db.select().from(pageContentTable);
    res.json(rows.map(r => ({ page: r.page, content: r.content, updatedAt: r.updatedAt?.toISOString() })));
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Failed" });
  }
});

// PUT /page-content/:page — admin only
router.put("/page-content/:page", requireAdmin, async (req, res) => {
  try {
    const page = req.params.page as string;
    const { content } = req.body;
    if (!content) { res.status(400).json({ error: "Content is required" }); return; }

    const existing = await db.select().from(pageContentTable).where(eq(pageContentTable.page, page));
    if (existing.length === 0) {
      const [row] = await db.insert(pageContentTable).values({ page, content }).returning();
      res.json({ page: row.page, content: row.content });
    } else {
      const [row] = await db.update(pageContentTable)
        .set({ content, updatedAt: new Date() })
        .where(eq(pageContentTable.page, page))
        .returning();
      res.json({ page: row.page, content: row.content });
    }
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Failed to update page content" });
  }
});

export default router;
