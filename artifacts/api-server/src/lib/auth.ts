import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import { Request, Response, NextFunction } from "express";

const JWT_SECRET = process.env.SESSION_SECRET || "pearlis-secret-key";

export function signToken(payload: { id: number; email: string; role: string }) {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: "7d" });
}

export function verifyToken(token: string): { id: number; email: string; role: string } | null {
  try {
    return jwt.verify(token, JWT_SECRET) as { id: number; email: string; role: string };
  } catch {
    return null;
  }
}

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 10);
}

export async function comparePassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

function resolveJwtUser(req: Request): { id: number; email: string; role: string } | null {
  const authHeader = req.headers["authorization"];
  if (!authHeader?.startsWith("Bearer ")) return null;
  const token = authHeader.slice(7);
  return verifyToken(token);
}

export function optionalAuth(req: Request, res: Response, next: NextFunction) {
  const jwtUser = resolveJwtUser(req);
  if (jwtUser) {
    (req as any).user = jwtUser;
  }
  next();
}

export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  const jwtUser = resolveJwtUser(req);
  if (jwtUser) {
    (req as any).user = jwtUser;
    return next();
  }
  res.status(401).json({ error: "Unauthorized" });
}

export function requireAdmin(req: Request, res: Response, next: NextFunction) {
  const jwtUser = resolveJwtUser(req);
  if (!jwtUser) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  if (jwtUser.role !== "admin") {
    res.status(403).json({ error: "Forbidden" });
    return;
  }
  (req as any).user = jwtUser;
  next();
}

export function getSessionId(req: Request): string {
  const user = (req as any).user;
  if (user) return `user-${user.id}`;
  const header = req.headers["x-session-id"];
  if (typeof header === "string" && header) return header;
  return "anonymous";
}
