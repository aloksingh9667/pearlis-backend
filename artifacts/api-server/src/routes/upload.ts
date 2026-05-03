import { Router } from "express";
import multer from "multer";
import path from "path";
import fs from "fs";
import { requireAdmin } from "../lib/auth";

const router = Router();

const UPLOAD_DIR = path.join(process.cwd(), "uploads");
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 100 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowed = /video\/(mp4|webm|ogg|quicktime|x-msvideo)|image\//;
    cb(null, allowed.test(file.mimetype));
  },
});

router.post("/upload", requireAdmin, upload.single("file"), (req, res) => {
  if (!req.file) { res.status(400).json({ error: "No file uploaded" }); return; }
  const url = `/api/uploads/${req.file.filename}`;
  res.json({ url, filename: req.file.filename, size: req.file.size });
});

export default router;
