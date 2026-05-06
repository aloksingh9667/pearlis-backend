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

const storage = multer.memoryStorage();

const upload = multer({
  storage,
  limits: { fileSize: 100 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowed = /video\/(mp4|webm|ogg|quicktime|x-msvideo)|image\//;
    cb(null, allowed.test(file.mimetype));
  },
});

type CloudinaryTransformation = Record<string, unknown>;

/** Returns the right folder + transformations based on upload context */
function resolveUploadOptions(folder: string, isVideo: boolean): {
  cloudFolder: string;
  transformation: CloudinaryTransformation[] | undefined;
} {
  if (isVideo) {
    // Videos: just normalize, no image transforms
    return {
      cloudFolder: `pearlis/${folder}`,
      transformation: undefined,
    };
  }

  switch (folder) {
    case "products":
      return {
        cloudFolder: "pearlis/products",
        transformation: [
          { width: 1200, crop: "limit" },
          { quality: "auto:best", fetch_format: "auto" },
        ],
      };

    case "gallery":
      return {
        cloudFolder: "pearlis/gallery",
        transformation: [
          { width: 1920, crop: "limit" },
          { quality: "auto:good", fetch_format: "auto" },
        ],
      };

    case "branding": // logo, favicon, site icons
      return {
        cloudFolder: "pearlis/branding",
        transformation: [
          { quality: "auto:best", fetch_format: "auto" },
        ],
      };

    case "blogs":
      return {
        cloudFolder: "pearlis/blogs",
        transformation: [
          { width: 1200, crop: "limit" },
          { quality: "auto:good", fetch_format: "auto" },
        ],
      };

    case "videos-thumb":
      return {
        cloudFolder: "pearlis/videos",
        transformation: [
          { width: 800, crop: "limit" },
          { quality: "auto", fetch_format: "auto" },
        ],
      };

    case "page-content":
      return {
        cloudFolder: "pearlis/page-content",
        transformation: [
          { width: 1920, crop: "limit" },
          { quality: "auto:good", fetch_format: "auto" },
        ],
      };

    default:
      return {
        cloudFolder: "pearlis/uploads",
        transformation: [
          { quality: "auto", fetch_format: "auto" },
        ],
      };
  }
}

function uploadToCloudinary(
  buffer: Buffer,
  mimetype: string,
  folder: string,
): Promise<{ url: string; public_id: string }> {
  const isVideo = mimetype.startsWith("video/");
  const resourceType = isVideo ? "video" : "image";
  const { cloudFolder, transformation } = resolveUploadOptions(folder, isVideo);

  return new Promise((resolve, reject) => {
    const uploadStream = cloudinary.uploader.upload_stream(
      { folder: cloudFolder, resource_type: resourceType, transformation },
      (error, result) => {
        if (error || !result) return reject(error ?? new Error("Upload failed"));
        resolve({ url: result.secure_url, public_id: result.public_id });
      },
    );
    uploadStream.end(buffer);
  });
}

router.post("/upload", requireAdmin, upload.single("file"), async (req, res) => {
  if (!req.file) {
    res.status(400).json({ error: "No file uploaded" });
    return;
  }

  try {
    const folder = typeof req.query.folder === "string" ? req.query.folder : "uploads";

    const { url, public_id } = await uploadToCloudinary(
      req.file.buffer,
      req.file.mimetype,
      folder,
    );

    res.json({ url, public_id, size: req.file.size });
  } catch (err) {
    console.error("Cloudinary upload error:", err);
    res.status(500).json({ error: "Upload to Cloudinary failed" });
  }
});

export default router;
