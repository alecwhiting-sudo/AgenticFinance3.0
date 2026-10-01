/**
 * Activity: emit events and broadcast them to SSE subscribers.
 * The broadcaster tails agent.activity_event by seq, so events written by any
 * process (API or worker) reach every connected workbench within ~1s.
 */
import { activityEvent } from "@af/db";
import { gt } from "drizzle-orm";
import { db } from "./db.js";

export type ActivityRow = typeof activityEvent.$inferSelect;

type Subscriber = (row: ActivityRow) => void;
const subscribers = new Set<Subscriber>();
let lastSeq = 0;
let tailing = false;

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
  await db.insert(activityEvent).values(e);
}

export function subscribe(fn: Subscriber): () => void {
  subscribers.add(fn);
  return () => subscribers.delete(fn);
}

export async function recentActivity(limit = 50): Promise<ActivityRow[]> {
  if (!db) return [];
  return db.query.activityEvent.findMany({
    orderBy: (t, { desc }) => desc(t.seq),
    limit,
  });
}

export function startActivityTail(intervalMs = 1000): void {
  if (tailing || !db) return;
  const database = db;
  tailing = true;
  void (async () => {
    const latest = await database.query.activityEvent.findFirst({
      orderBy: (t, { desc }) => desc(t.seq),
    });
    lastSeq = latest?.seq ?? 0;
    setInterval(async () => {
      if (subscribers.size === 0) return;
      try {
        const rows = await database
          .select()
          .from(activityEvent)
          .where(gt(activityEvent.seq, lastSeq))
          .orderBy(activityEvent.seq)
          .limit(200);
        for (const row of rows) {
          lastSeq = Math.max(lastSeq, row.seq);
          for (const fn of subscribers) fn(row);
        }
      } catch {
        // transient DB issue; next tick retries
      }
    }, intervalMs);
  })();
}
