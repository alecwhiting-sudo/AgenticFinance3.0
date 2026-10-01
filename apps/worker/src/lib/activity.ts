import { activityEvent } from "@af/db";
import { db } from "./db.js";

export async function emitActivity(e: {
  actorType: "agent" | "human" | "system";
  actorId: string;
  verb: string;
  objectType?: string;
  objectId?: string;
  caseId?: string;
  summary: string;
}): Promise<void> {
  if (!db) return;
  try {
    await db.insert(activityEvent).values(e);
  } catch {
    // activity is best-effort; never fail work because of it
  }
}
