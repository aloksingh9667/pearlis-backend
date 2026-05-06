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

function uploadToCloudinary(
  buffer: Buffer,
  mimetype: string,
  folder: string,
): Promise<{ url: string; public_id: string }> {
  return new Promise((resolve, reject) => {
    const resourceType = mimetype.startsWith("video/") ? "video" : "image";
    const uploadStream = cloudinary.uploader.upload_stream(
      {
        folder,
        resource_type: resourceType,
        transformation:
          resourceType === "image"
            ? [{ quality: "auto", fetch_format: "auto" }]
            : undefined,
      },
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
    const folder = req.query.folder
      ? `pearlis/${req.query.folder}`
      : "pearlis/uploads";

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
