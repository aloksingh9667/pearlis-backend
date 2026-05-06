import { Router } from "express";
import multer from "multer";
import { v2 as cloudinary } from "cloudinary";
import { requireAdmin } from "../lib/auth";

const router = Router();

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME ?? "drelvi6a3",
  api_key: process.env.CLOUDINARY_API_KEY ?? "929738938678791",
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

/* ─────────────────────────────────────────────
   Cloudinary folder + transformation registry

   Structure on Cloudinary:
   pearlis/
   ├── branding/
   │   ├── logo/        ← site logo
   │   ├── favicon/     ← favicon / app icon
   │   └── icons/       ← other brand icons
   ├── products/
   │   ├── images/      ← product photos (hero + gallery shots)
   │   └── videos/      ← product demo / unboxing videos
   ├── gallery/
   │   └── photos/      ← lookbook / editorial gallery
   ├── blog/
   │   ├── covers/      ← blog post cover / thumbnail
   │   └── content/     ← inline images inside blog posts
   ├── videos/
   │   ├── featured/    ← homepage hero / brand story videos
   │   └── lookbook/    ← admin-managed lookbook videos
   ├── page-content/
   │   ├── hero/        ← homepage hero slides
   │   ├── banners/     ← promotional / sale banners
   │   └── sections/    ← about, team, misc page sections
   └── uploads/
       └── misc/        ← uncategorised fallback
───────────────────────────────────────────── */

type Transform = Record<string, unknown>;

interface UploadConfig {
  cloudFolder: string;
  transformation?: Transform[];
  resourceType: "image" | "video" | "auto";
}

const FOLDER_CONFIG: Record<string, UploadConfig> = {
  // ── Branding ──────────────────────────────────────
  "branding/logo": {
    cloudFolder: "pearlis/branding/logo",
    resourceType: "image",
    transformation: [
      { quality: "auto:best", fetch_format: "auto" },
    ],
  },
  "branding/favicon": {
    cloudFolder: "pearlis/branding/favicon",
    resourceType: "image",
    transformation: [
      { width: 256, height: 256, crop: "limit" },
      { quality: "auto:best", fetch_format: "auto" },
    ],
  },
  "branding/icons": {
    cloudFolder: "pearlis/branding/icons",
    resourceType: "image",
    transformation: [
      { quality: "auto:best", fetch_format: "auto" },
    ],
  },

  // ── Products ──────────────────────────────────────
  "products/images": {
    cloudFolder: "pearlis/products/images",
    resourceType: "image",
    transformation: [
      { width: 1200, crop: "limit" },
      { quality: "auto:best", fetch_format: "auto" },
    ],
  },
  "products/videos": {
    cloudFolder: "pearlis/products/videos",
    resourceType: "video",
    transformation: undefined,
  },

  // ── Gallery ───────────────────────────────────────
  "gallery/photos": {
    cloudFolder: "pearlis/gallery/photos",
    resourceType: "image",
    transformation: [
      { width: 1920, crop: "limit" },
      { quality: "auto:good", fetch_format: "auto" },
    ],
  },

  // ── Blog ──────────────────────────────────────────
  "blog/covers": {
    cloudFolder: "pearlis/blog/covers",
    resourceType: "image",
    transformation: [
      { width: 1200, height: 630, crop: "fill", gravity: "auto" },
      { quality: "auto:good", fetch_format: "auto" },
    ],
  },
  "blog/content": {
    cloudFolder: "pearlis/blog/content",
    resourceType: "image",
    transformation: [
      { width: 1200, crop: "limit" },
      { quality: "auto:good", fetch_format: "auto" },
    ],
  },

  // ── Videos ────────────────────────────────────────
  "videos/featured": {
    cloudFolder: "pearlis/videos/featured",
    resourceType: "video",
    transformation: undefined,
  },
  "videos/lookbook": {
    cloudFolder: "pearlis/videos/lookbook",
    resourceType: "video",
    transformation: undefined,
  },

  // ── Page Content ──────────────────────────────────
  "page-content/hero": {
    cloudFolder: "pearlis/page-content/hero",
    resourceType: "image",
    transformation: [
      { width: 1920, crop: "limit" },
      { quality: "auto:good", fetch_format: "auto" },
    ],
  },
  "page-content/banners": {
    cloudFolder: "pearlis/page-content/banners",
    resourceType: "image",
    transformation: [
      { width: 1920, crop: "limit" },
      { quality: "auto:good", fetch_format: "auto" },
    ],
  },
  "page-content/sections": {
    cloudFolder: "pearlis/page-content/sections",
    resourceType: "image",
    transformation: [
      { width: 1440, crop: "limit" },
      { quality: "auto:good", fetch_format: "auto" },
    ],
  },
};

/** Fallback for unknown / missing folder keys */
function resolveConfig(folderKey: string, mimetype: string): UploadConfig {
  if (FOLDER_CONFIG[folderKey]) return FOLDER_CONFIG[folderKey];

  // Graceful fallback: honour legacy single-level keys
  const legacyMap: Record<string, string> = {
    branding: "branding/logo",
    products: "products/images",
    gallery: "gallery/photos",
    blogs: "blog/covers",
    "videos-thumb": "page-content/sections",
    "page-content": "page-content/sections",
    videos: mimetype.startsWith("video/") ? "videos/lookbook" : "page-content/sections",
  };

  const mapped = legacyMap[folderKey];
  if (mapped && FOLDER_CONFIG[mapped]) return FOLDER_CONFIG[mapped];

  return {
    cloudFolder: "pearlis/uploads/misc",
    resourceType: mimetype.startsWith("video/") ? "video" : "image",
    transformation: [{ quality: "auto", fetch_format: "auto" }],
  };
}

/* ── Multer — store in memory, stream to Cloudinary ── */
const storage = multer.memoryStorage();

const upload = multer({
  storage,
  limits: { fileSize: 100 * 1024 * 1024 }, // 100 MB
  fileFilter: (_req, file, cb) => {
    const allowed = /video\/(mp4|webm|ogg|quicktime|x-msvideo)|image\//;
    cb(null, allowed.test(file.mimetype));
  },
});

function streamToCloudinary(
  buffer: Buffer,
  config: UploadConfig,
): Promise<{ url: string; public_id: string }> {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        folder: config.cloudFolder,
        resource_type: config.resourceType,
        transformation: config.transformation,
      },
      (error, result) => {
        if (error || !result) return reject(error ?? new Error("Cloudinary upload failed"));
        resolve({ url: result.secure_url, public_id: result.public_id });
      },
    );
    stream.end(buffer);
  });
}

/* ── Route ── */
router.post("/upload", requireAdmin, upload.single("file"), async (req, res) => {
  if (!req.file) {
    res.status(400).json({ error: "No file uploaded" });
    return;
  }

  const folderKey = typeof req.query.folder === "string" ? req.query.folder : "uploads/misc";
  const config = resolveConfig(folderKey, req.file.mimetype);

  try {
    const { url, public_id } = await streamToCloudinary(req.file.buffer, config);
    res.json({ url, public_id, size: req.file.size, folder: config.cloudFolder });
  } catch (err) {
    console.error("Cloudinary upload error:", err);
    res.status(500).json({ error: "Upload to Cloudinary failed" });
  }
});

export default router;
