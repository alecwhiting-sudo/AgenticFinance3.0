import { z } from "zod";

/** Health status reported by every service at /health. */
export const healthSchema = z.object({
  status: z.enum(["ok", "degraded"]),
  service: z.string(),
  db: z.enum(["ok", "unavailable"]),
  version: z.string(),
  time: z.string(),
});
export type Health = z.infer<typeof healthSchema>;

/** Company overview served by the API for the workbench dashboard. */
export const companyOverviewSchema = z.object({
  company: z.object({
    code: z.string(),
    name: z.string(),
    currency: z.string(),
  }),
  currentPeriod: z
    .object({ code: z.string(), status: z.enum(["open", "closed"]) })
    .nullable(),
  counts: z.object({
    accounts: z.number(),
    suppliers: z.number(),
    customers: z.number(),
    items: z.number(),
  }),
});
export type CompanyOverview = z.infer<typeof companyOverviewSchema>;

/**
 * Activity events power the live experience layer (ARCHITECTURE.md §6a).
 * Phase 0 defines the envelope; producers and the SSE stream arrive in
 * Phase 1 with the agent framework.
 */
export const activityEventSchema = z.object({
  id: z.string(),
  at: z.string(),
  actorType: z.enum(["agent", "human", "system"]),
  actorId: z.string(),
  verb: z.string(),
  objectType: z.string().nullable(),
  objectId: z.string().nullable(),
  caseId: z.string().nullable(),
  summary: z.string(),
});
export type ActivityEvent = z.infer<typeof activityEventSchema>;
