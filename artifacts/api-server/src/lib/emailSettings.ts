import { db } from "@workspace/db";
import { siteSettingsTable } from "@workspace/db";
import { eq } from "drizzle-orm";

export async function isEmailEnabled(key: string): Promise<boolean> {
  try {
    const [setting] = await db
      .select()
      .from(siteSettingsTable)
      .where(eq(siteSettingsTable.key, "emailNotifications"));
    if (!setting) return true;
    const config = setting.value as Record<string, boolean>;
    return config[key] !== false;
  } catch {
    return true;
  }
}
