import type { FastifyInstance } from "fastify";
import { sql } from "drizzle-orm";
import { requireDb } from "../lib/db.js";

/** Phase 4c M1 (plans/ANALYTICS.md): the curated view catalogue. Every
 * endpoint here is a read-only derived aggregation over journal lines and
 * the open-item tables — never alternative measurement logic, never
 * model-generated SQL. This catalogue is also the Analyst Agent's entire
 * data surface in M2: if a question can't be answered from these views,
 * the agent says so rather than reaching past them. */

/** The catalogue, served to the UI and (M2) handed to the Analyst Agent as
 * its tool menu. `params` documents what each view accepts. */
export const VIEW_CATALOGUE = [
  {
    id: "pl-trend",
    title: "P&L trend",
    question: "How are income and expense lines moving month to month?",
    params: { year: "YYYY (default: latest year with journals)", from: "YYYY-MM window start", to: "YYYY-MM window end" },
    drill: "/ledger/{code}?period={period}",
  },
  {
    id: "flux",
    title: "Month flux",
    question: "Why did the result move versus the prior month (or prior quarter/YTD window)?",
    params: { period: "YYYY-MM (default: latest period with P&L activity)", from: "YYYY-MM — with `to`, compares the window to the equal-length prior window", to: "YYYY-MM" },
    drill: "/ledger/{code}?period={period}",
  },
  {
    id: "aging",
    title: "AP / AR aging",
    question: "Who do we owe / who owes us, and how overdue is it?",
    params: { side: "ap | ar", asOf: "YYYY-MM-DD (default: today)" },
    drill: "/p2p/invoices (ap) · /o2c (ar)",
  },
  {
    id: "counterparty",
    title: "Supplier spend / customer revenue",
    question: "Where does spend or revenue concentrate?",
    params: { dim: "supplier | customer", from: "YYYY-MM (invoice month window)", to: "YYYY-MM" },
    drill: "/p2p/suppliers/{code} (supplier) · /o2c (customer)",
  },
  {
    id: "cash",
    title: "Cash position",
    question: "What is the bank balance doing over time?",
    params: { from: "YYYY-MM (trim returned dates; balance stays cumulative)", to: "YYYY-MM" },
    drill: "/payments",
  },
] as const;

const AGING_BUCKETS = ["current", "1-30", "31-60", "61-90", "90+"] as const;

/** The record catalogue (4c follow-on): per-entity read-only queries over
 * everything on the platform, so the Analyst can scan actual records — not
 * just the aggregated views. Still governed by construction: the caller
 * picks an entity and whitelisted filters; the SQL is built HERE, never by
 * a model. Rows are capped and columns are curated per entity.
 *
 * `access` is the data-permissions STUB (plans/ANALYTICS.md §7): every
 * entity declares the scope a caller will need once permissions land.
 * Today every scope is granted to the workbench and the Analyst; the field
 * exists so enforcement is one check at this endpoint, not a refactor. */
export const ENTITY_CATALOGUE = [
  {
    id: "purchases",
    what: "Purchase orders (requisition=PO): approval band/status, totals, receipt and invoice coverage.",
    filters: { party: "supplier code or name fragment", status: "requested|approved|rejected|closed…", from: "YYYY-MM-DD (request date)", to: "YYYY-MM-DD", search: "PO number fragment" },
    access: "p2p.read",
  },
  {
    id: "goods_receipts",
    what: "Goods receipts booked against purchases.",
    filters: { party: "supplier code or name fragment", search: "GRN or PO number fragment" },
    access: "p2p.read",
  },
  {
    id: "ap_invoices",
    what: "Supplier invoices: status, exception code, PO reference (or none), amounts, dates.",
    filters: { party: "supplier code or name fragment", status: "captured|matched|exception|approved|posted|scheduled|paid|rejected", hasPurchase: "true|false — raised against a PO or not", period: "YYYY-MM (invoice month)", search: "invoice number fragment" },
    access: "p2p.read",
  },
  {
    id: "ar_invoices",
    what: "Customer invoices: status, amounts, dates.",
    filters: { party: "customer code or name fragment", status: "issued|posted|paid", period: "YYYY-MM (invoice month)", search: "invoice number fragment" },
    access: "o2c.read",
  },
  {
    id: "payments",
    what: "AP payment runs: reference, run date, total, status, invoices covered.",
    filters: { status: "proposed|approved|executed…", search: "payment ref fragment" },
    access: "p2p.read",
  },
  {
    id: "bank_transactions",
    what: "Bank statement lines: date, amount (positive = money in), counterparty, match status.",
    filters: { status: "unmatched|matched", kind: "ap_payment|ar_receipt|salaries|vat|bank_fees", from: "YYYY-MM-DD", to: "YYYY-MM-DD", search: "reference/counterparty fragment" },
    access: "r2r.read",
  },
  {
    id: "journals",
    what: "Posted journals: number, date, memo, source type.",
    filters: { period: "YYYY-MM", sourceType: "ap_invoice|ap_payment|ar_invoice|bank_txn|accrual…", search: "memo fragment" },
    access: "r2r.read",
  },
  {
    id: "suppliers",
    what: "Supplier master records: code, name, payment terms.",
    filters: { search: "code or name fragment" },
    access: "master.read",
  },
  {
    id: "customers",
    what: "Customer master records: code, name, payment terms.",
    filters: { search: "code or name fragment" },
    access: "master.read",
  },
] as const;

type RecordFilters = {
  party?: string;
  status?: string;
  kind?: string;
  hasPurchase?: string;
  period?: string;
  sourceType?: string;
  from?: string;
  to?: string;
  search?: string;
};

const DATEISH = /^\d{4}-\d{2}(-\d{2})?$/;
/** Guard every free-text filter: short, no SQL metacharacters needed —
 * values are parameterized anyway, this just keeps ILIKE patterns sane. */
const frag = (s: string | undefined, max = 60) => (s ? `%${s.slice(0, max)}%` : undefined);

export function analyticsRoutes(app: FastifyInstance): void {
  app.get("/analytics/views", async () => ({ views: VIEW_CATALOGUE }));
  app.get("/analytics/entities", async () => ({ entities: ENTITY_CATALOGUE }));

  /** One governed endpoint for every entity: whitelisted filters in,
   * parameterized SQL here, curated columns + aggregates out, 50 rows max. */
  app.get<{ Querystring: RecordFilters & { entity?: string; limit?: string } }>(
    "/analytics/records",
    async (req, reply) => {
      const db = requireDb();
      const q = req.query;
      const entity = String(q.entity ?? "");
      if (!ENTITY_CATALOGUE.some((e) => e.id === entity))
        return reply.code(400).send({ error: `unknown entity — valid: ${ENTITY_CATALOGUE.map((e) => e.id).join(", ")}` });
      const limit = Math.min(50, Math.max(1, Number(q.limit) || 20));
      // undefined must become null before it reaches a SQL parameter
      const party = frag(q.party) ?? null;
      const search = frag(q.search) ?? null;
      const status = q.status?.slice(0, 30) ?? null;
      const period = q.period && /^\d{4}-\d{2}$/.test(q.period) ? q.period : null;
      const from = q.from && DATEISH.test(q.from) ? q.from : null;
      const to = q.to && DATEISH.test(q.to) ? q.to : null;

      const run = async (query: ReturnType<typeof sql>) => (await db.execute(query)).rows;

      if (entity === "purchases") {
        const rows = await run(sql`
          select p.number, s.code as party_code, s.name as party_name, p.status,
                 p.approval_band, p.total_minor::bigint as total_minor, p.request_date, p.order_date,
                 (select count(*) from erp.goods_receipt g where g.purchase_id = p.id)::int as receipts,
                 (select count(*) from erp.ap_invoice i where i.purchase_id = p.id)::int as invoices
          from erp.purchase p join erp.supplier s on s.id = p.supplier_id and p.book <> 'test'
          where (${party}::text is null or s.code ilike ${party} or s.name ilike ${party})
            and (${status}::text is null or p.status::text = ${status})
            and (${from}::text is null or p.request_date >= ${from}::date)
            and (${to}::text is null or p.request_date <= ${to}::date)
            and (${search}::text is null or p.number ilike ${search})
          order by p.request_date desc limit ${limit}
        `);
        const [agg] = await run(sql`
          select count(*)::int as total, coalesce(sum(p.total_minor), 0)::bigint as sum_total_minor,
                 (select jsonb_object_agg(status, n) from (
                    select p2.status::text, count(*)::int as n from erp.purchase p2
                    join erp.supplier s2 on s2.id = p2.supplier_id and p2.book <> 'test'
                    where (${party}::text is null or s2.code ilike ${party} or s2.name ilike ${party})
                    group by 1) t(status, n)) as by_status
          from erp.purchase p join erp.supplier s on s.id = p.supplier_id and p.book <> 'test'
          where (${party}::text is null or s.code ilike ${party} or s.name ilike ${party})
        `);
        return { entity, rows, shown: rows.length, aggregates: agg ?? null };
      }

      if (entity === "goods_receipts") {
        const rows = await run(sql`
          select g.number, p.number as purchase_number, s.code as party_code, s.name as party_name,
                 g.receipt_date, g.recorded_by
          from erp.goods_receipt g
          join erp.purchase p on p.id = g.purchase_id
          join erp.supplier s on s.id = p.supplier_id and p.book <> 'test'
          where (${party}::text is null or s.code ilike ${party} or s.name ilike ${party})
            and (${search}::text is null or g.number ilike ${search} or p.number ilike ${search})
          order by g.receipt_date desc limit ${limit}
        `);
        return { entity, rows, shown: rows.length, aggregates: null };
      }

      if (entity === "ap_invoices" || entity === "ar_invoices") {
        const ap = entity === "ap_invoices";
        const hasPurchase = ap && (q.hasPurchase === "true" || q.hasPurchase === "false") ? q.hasPurchase === "true" : undefined;
        const rows = ap
          ? await run(sql`
              select i.supplier_invoice_number as number, s.code as party_code, s.name as party_name,
                     p.number as purchase_number, i.status, i.exception_code,
                     i.gross_minor::bigint as gross_minor, i.invoice_date, i.due_date, i.format
              from erp.ap_invoice i
              join erp.supplier s on s.id = i.supplier_id and i.book <> 'test'
              left join erp.purchase p on p.id = i.purchase_id
              where (${party}::text is null or s.code ilike ${party} or s.name ilike ${party})
                and (${status}::text is null or i.status::text = ${status})
                and (${hasPurchase ?? null}::boolean is null or (i.purchase_id is not null) = ${hasPurchase ?? null}::boolean)
                and (${period}::text is null or to_char(i.invoice_date, 'YYYY-MM') = ${period})
                and (${search}::text is null or i.supplier_invoice_number ilike ${search})
              order by i.invoice_date desc limit ${limit}
            `)
          : await run(sql`
              select i.number, c.code as party_code, c.name as party_name, null as purchase_number,
                     i.status, null as exception_code, i.gross_minor::bigint as gross_minor,
                     i.invoice_date, i.due_date, null as format
              from erp.ar_invoice i join erp.customer c on c.id = i.customer_id
              where (${party}::text is null or c.code ilike ${party} or c.name ilike ${party})
                and (${status}::text is null or i.status::text = ${status})
                and (${period}::text is null or to_char(i.invoice_date, 'YYYY-MM') = ${period})
                and (${search}::text is null or i.number ilike ${search})
              order by i.invoice_date desc limit ${limit}
            `);
        const [agg] = ap
          ? await run(sql`
              select count(*)::int as total, coalesce(sum(i.gross_minor), 0)::bigint as sum_gross_minor,
                     count(*) filter (where i.purchase_id is not null)::int as with_purchase,
                     count(*) filter (where i.purchase_id is null)::int as without_purchase,
                     (select jsonb_object_agg(status, n) from (
                        select i2.status::text, count(*)::int as n from erp.ap_invoice i2
                        join erp.supplier s2 on s2.id = i2.supplier_id and i2.book <> 'test'
                        where (${party}::text is null or s2.code ilike ${party} or s2.name ilike ${party})
                        group by 1) t(status, n)) as by_status
              from erp.ap_invoice i join erp.supplier s on s.id = i.supplier_id and i.book <> 'test'
              where (${party}::text is null or s.code ilike ${party} or s.name ilike ${party})
            `)
          : await run(sql`
              select count(*)::int as total, coalesce(sum(i.gross_minor), 0)::bigint as sum_gross_minor,
                     (select jsonb_object_agg(status, n) from (
                        select i2.status::text, count(*)::int as n from erp.ar_invoice i2
                        join erp.customer c2 on c2.id = i2.customer_id
                        where (${party}::text is null or c2.code ilike ${party} or c2.name ilike ${party})
                        group by 1) t(status, n)) as by_status
              from erp.ar_invoice i join erp.customer c on c.id = i.customer_id
              where (${party}::text is null or c.code ilike ${party} or c.name ilike ${party})
            `);
        return { entity, rows, shown: rows.length, aggregates: agg ?? null };
      }

      if (entity === "payments") {
        const rows = await run(sql`
          select pay.payment_ref, pay.run_date, pay.total_minor::bigint as total_minor, pay.status,
                 jsonb_array_length(pay.invoice_ids)::int as invoices, pay.executed_at
          from erp.ap_payment pay
          where (${status}::text is null or pay.status::text = ${status})
            and (${search}::text is null or pay.payment_ref ilike ${search})
          order by pay.run_date desc limit ${limit}
        `);
        return { entity, rows, shown: rows.length, aggregates: null };
      }

      if (entity === "bank_transactions") {
        const kind = q.kind?.slice(0, 30);
        const rows = await run(sql`
          select b.txn_date, b.amount_minor::bigint as amount_minor, b.reference, b.counterparty,
                 b.kind, b.status, b.matched_type
          from erp.bank_transaction b
          where (${status}::text is null or b.status::text = ${status})
            and (${kind ?? null}::text is null or b.kind = ${kind ?? null})
            and (${from}::text is null or b.txn_date >= ${from}::date)
            and (${to}::text is null or b.txn_date <= ${to}::date)
            and (${search}::text is null or b.reference ilike ${search} or b.counterparty ilike ${search})
          order by b.txn_date desc limit ${limit}
        `);
        const [agg] = await run(sql`
          select count(*)::int as total,
                 count(*) filter (where status = 'unmatched')::int as unmatched,
                 coalesce(sum(amount_minor), 0)::bigint as net_minor
          from erp.bank_transaction
        `);
        return { entity, rows, shown: rows.length, aggregates: agg ?? null };
      }

      if (entity === "journals") {
        const sourceType = q.sourceType?.slice(0, 30);
        const rows = await run(sql`
          select j.number, j.journal_date, j.period_code, j.memo, j.source_type, j.status
          from erp.journal j
          where (${period}::text is null or j.period_code = ${period})
            and (${sourceType ?? null}::text is null or j.source_type = ${sourceType ?? null})
            and (${search}::text is null or j.memo ilike ${search})
            and j.book <> 'test'
          order by j.number desc limit ${limit}
        `);
        return { entity, rows, shown: rows.length, aggregates: null };
      }

      // suppliers / customers master data
      const table = entity === "suppliers" ? sql`erp.supplier` : sql`erp.customer`;
      const rows = await run(sql`
        select code, name, payment_terms_days
        from ${table}
        where (${search}::text is null or code ilike ${search} or name ilike ${search})
        order by code limit ${limit}
      `);
      return { entity, rows, shown: rows.length, aggregates: null };
    },
  );

  /** Monthly movement per P&L account for a year. Sign convention is the
   * ledger's (debit positive); the UI flips income for display. */
  app.get<{ Querystring: { year?: string; from?: string; to?: string } }>("/analytics/pl-trend", async (req) => {
    const db = requireDb();
    const MONTH = /^\d{4}-\d{2}$/;
    let year = /^\d{4}$/.test(req.query.year ?? "") ? Number(req.query.year) : undefined;
    if (!year) {
      const latest = (
        await db.execute(sql`select max(period_code) as p from erp.journal where book <> 'test'`)
      ).rows[0] as { p: string | null };
      year = latest.p ? Number(latest.p.slice(0, 4)) : new Date().getUTCFullYear();
    }
    // period-lens window overrides the year default
    const from = MONTH.test(req.query.from ?? "") ? req.query.from! : `${year}-01`;
    const to = MONTH.test(req.query.to ?? "") ? req.query.to! : `${year}-12`;
    const rows = (
      await db.execute(sql`
        select a.code, a.name, a.type, j.period_code, sum(jl.amount_minor)::bigint as amount_minor
        from erp.journal_line jl
        join erp.journal j on j.id = jl.journal_id and j.book <> 'test'
        join erp.account a on a.code = jl.account_code
        where a.type in ('income', 'expense') and j.period_code >= ${from} and j.period_code <= ${to}
        group by a.code, a.name, a.type, j.period_code
        order by a.code, j.period_code
      `)
    ).rows as { code: string; name: string; type: string; period_code: string; amount_minor: string }[];
    const months = [...new Set(rows.map((r) => r.period_code))].sort();
    return {
      view: "pl-trend",
      year,
      from,
      to,
      months,
      rows: rows.map((r) => ({ ...r, amount_minor: Number(r.amount_minor) })),
    };
  });

  /** Per-account movement delta: period vs prior month, P&L accounts.
   * Feeds the waterfall — favourable/adverse is decided by the UI from
   * account type and sign (meaning, not raw sign).
   * Period-lens windows (PR-B): `from`/`to` month codes aggregate the window
   * and compare it to the equal-length window immediately before it (Q3 vs
   * Q2, YTD Sep vs the preceding nine months). Without them, single month vs
   * prior month as before. */
  app.get<{ Querystring: { period?: string; from?: string; to?: string } }>("/analytics/flux", async (req, reply) => {
    const db = requireDb();
    const MONTH = /^\d{4}-\d{2}$/;
    const wFrom = MONTH.test(req.query.from ?? "") ? req.query.from! : undefined;
    const wTo = MONTH.test(req.query.to ?? "") ? req.query.to! : undefined;
    let period = /^\d{4}-\d{2}$/.test(req.query.period ?? "") ? req.query.period! : undefined;
    const currentMonth = new Date().toISOString().slice(0, 7);
    if (wFrom && wTo && wFrom <= wTo && wFrom !== wTo) {
      // window mode: [from..to] vs the same-length window ending just before
      const len = monthsBetween(wFrom, wTo);
      const priorTo = shiftMonth(wFrom, -1);
      const priorFrom = shiftMonth(priorTo, -(len - 1));
      const rows = (
        await db.execute(sql`
          select a.code, a.name, a.type,
            coalesce(sum(jl.amount_minor) filter (where j.period_code >= ${wFrom} and j.period_code <= ${wTo}), 0)::bigint as this_minor,
            coalesce(sum(jl.amount_minor) filter (where j.period_code >= ${priorFrom} and j.period_code <= ${priorTo}), 0)::bigint as prev_minor
          from erp.journal_line jl
          join erp.journal j on j.id = jl.journal_id and j.book <> 'test'
          join erp.account a on a.code = jl.account_code
          where a.type in ('income', 'expense')
            and j.period_code >= ${priorFrom} and j.period_code <= ${wTo}
          group by a.code, a.name, a.type
          having coalesce(sum(jl.amount_minor) filter (where j.period_code >= ${wFrom} and j.period_code <= ${wTo}), 0) <> 0
              or coalesce(sum(jl.amount_minor) filter (where j.period_code >= ${priorFrom} and j.period_code <= ${priorTo}), 0) <> 0
          order by a.code
        `)
      ).rows as { code: string; name: string; type: string; this_minor: string; prev_minor: string }[];
      const periods = (
        await db.execute(sql`
          select distinct j.period_code from erp.journal j
          join erp.journal_line jl on jl.journal_id = j.id and j.book <> 'test'
          join erp.account a on a.code = jl.account_code
          where a.type in ('income','expense') order by 1
        `)
      ).rows.map((r) => (r as { period_code: string }).period_code);
      return {
        view: "flux",
        period: wTo,
        prior: priorTo,
        from: wFrom,
        to: wTo,
        priorFrom,
        priorTo,
        partial: wTo >= currentMonth,
        periods,
        rows: rows.map((r) => ({
          code: r.code,
          name: r.name,
          type: r.type,
          thisMinor: Number(r.this_minor),
          prevMinor: Number(r.prev_minor),
          deltaMinor: Number(r.this_minor) - Number(r.prev_minor),
        })),
      };
    }
    if (!period) {
      // Default to the latest COMPLETE month: comparing a 3-day-old month to
      // a full prior month reads as "revenue collapsed" and means nothing.
      // The in-progress month stays selectable; the UI labels it "to date".
      const latest = (
        await db.execute(sql`
          select max(j.period_code) filter (where j.period_code < ${currentMonth}) as complete,
                 max(j.period_code) as any
          from erp.journal j
          join erp.journal_line jl on jl.journal_id = j.id and j.book <> 'test'
          join erp.account a on a.code = jl.account_code
          where a.type in ('income', 'expense')
        `)
      ).rows[0] as { complete: string | null; any: string | null };
      if (!latest.any) return reply.code(409).send({ error: "no P&L activity yet" });
      period = latest.complete ?? latest.any;
    }
    const prior = priorPeriod(period);
    const partial = period === currentMonth;
    const rows = (
      await db.execute(sql`
        select a.code, a.name, a.type,
          coalesce(sum(jl.amount_minor) filter (where j.period_code = ${period}), 0)::bigint as this_minor,
          coalesce(sum(jl.amount_minor) filter (where j.period_code = ${prior}), 0)::bigint as prev_minor
        from erp.journal_line jl
        join erp.journal j on j.id = jl.journal_id and j.book <> 'test'
        join erp.account a on a.code = jl.account_code
        where a.type in ('income', 'expense') and j.period_code in (${period}, ${prior})
        group by a.code, a.name, a.type
        having coalesce(sum(jl.amount_minor) filter (where j.period_code = ${period}), 0)
            <> coalesce(sum(jl.amount_minor) filter (where j.period_code = ${prior}), 0)
            or coalesce(sum(jl.amount_minor) filter (where j.period_code = ${period}), 0) <> 0
        order by a.code
      `)
    ).rows as { code: string; name: string; type: string; this_minor: string; prev_minor: string }[];
    const periods = (
      await db.execute(sql`
        select distinct j.period_code from erp.journal j
        join erp.journal_line jl on jl.journal_id = j.id and j.book <> 'test'
        join erp.account a on a.code = jl.account_code
        where a.type in ('income','expense') order by 1
      `)
    ).rows.map((r) => (r as { period_code: string }).period_code);
    return {
      view: "flux",
      period,
      partial,
      prior,
      periods,
      rows: rows.map((r) => ({
        code: r.code,
        name: r.name,
        type: r.type,
        thisMinor: Number(r.this_minor),
        prevMinor: Number(r.prev_minor),
        deltaMinor: Number(r.this_minor) - Number(r.prev_minor),
      })),
    };
  });

  /** Open-item aging by counterparty. Open AP = not paid/rejected; open AR =
   * not paid. Buckets by days past due at asOf; not-yet-due is "current". */
  app.get<{ Querystring: { side?: string; asOf?: string } }>("/analytics/aging", async (req, reply) => {
    const db = requireDb();
    const side = req.query.side === "ar" ? "ar" : req.query.side === "ap" || !req.query.side ? "ap" : null;
    if (!side) return reply.code(400).send({ error: "side must be ap or ar" });
    const asOf = /^\d{4}-\d{2}-\d{2}$/.test(req.query.asOf ?? "")
      ? req.query.asOf!
      : new Date().toISOString().slice(0, 10);

    const rows = (
      await db.execute(
        side === "ap"
          ? sql`
              select s.code, s.name, i.due_date, i.gross_minor, i.status
              from erp.ap_invoice i join erp.supplier s on s.id = i.supplier_id and i.book <> 'test'
              where i.status not in ('paid', 'rejected')
            `
          : sql`
              select c.code, c.name, i.due_date, i.gross_minor, i.status
              from erp.ar_invoice i join erp.customer c on c.id = i.customer_id
              where i.status <> 'paid'
            `,
      )
    ).rows as { code: string; name: string; due_date: string; gross_minor: string; status: string }[];

    const byParty = new Map<string, { code: string; name: string; buckets: number[]; totalMinor: number; items: number }>();
    for (const r of rows) {
      const days = Math.floor((Date.parse(asOf) - Date.parse(r.due_date)) / 86_400_000);
      const b = days <= 0 ? 0 : days <= 30 ? 1 : days <= 60 ? 2 : days <= 90 ? 3 : 4;
      const e = byParty.get(r.code) ?? { code: r.code, name: r.name, buckets: [0, 0, 0, 0, 0], totalMinor: 0, items: 0 };
      e.buckets[b]! += Number(r.gross_minor);
      e.totalMinor += Number(r.gross_minor);
      e.items += 1;
      byParty.set(r.code, e);
    }
    const parties = [...byParty.values()].sort((a, b) => b.totalMinor - a.totalMinor);
    return {
      view: "aging",
      side,
      asOf,
      buckets: AGING_BUCKETS,
      totalMinor: parties.reduce((n, p) => n + p.totalMinor, 0),
      overdueMinor: parties.reduce((n, p) => n + p.buckets.slice(1).reduce((x, y) => x + y, 0), 0),
      parties,
    };
  });

  /** Ranked counterparty totals with a monthly series each — invoiced gross
   * (AP) / billed gross (AR), from the invoice tables (period = invoice
   * month). Concentration, not cash timing. */
  app.get<{ Querystring: { dim?: string; from?: string; to?: string } }>("/analytics/counterparty", async (req, reply) => {
    const db = requireDb();
    const dim = req.query.dim === "customer" ? "customer" : req.query.dim === "supplier" || !req.query.dim ? "supplier" : null;
    if (!dim) return reply.code(400).send({ error: "dim must be supplier or customer" });
    const MONTH = /^\d{4}-\d{2}$/;
    const from = MONTH.test(req.query.from ?? "") ? req.query.from! : null;
    const to = MONTH.test(req.query.to ?? "") ? req.query.to! : null;
    const rows = (
      await db.execute(
        dim === "supplier"
          ? sql`
              select s.code, s.name, to_char(i.invoice_date, 'YYYY-MM') as period_code,
                     sum(i.gross_minor)::bigint as gross_minor, count(*)::int as invoices
              from erp.ap_invoice i join erp.supplier s on s.id = i.supplier_id and i.book <> 'test'
              where i.status <> 'rejected'
                and (${from}::text is null or to_char(i.invoice_date, 'YYYY-MM') >= ${from})
                and (${to}::text is null or to_char(i.invoice_date, 'YYYY-MM') <= ${to})
              group by s.code, s.name, to_char(i.invoice_date, 'YYYY-MM')
              order by s.code, to_char(i.invoice_date, 'YYYY-MM')
            `
          : sql`
              select c.code, c.name, to_char(i.invoice_date, 'YYYY-MM') as period_code,
                     sum(i.gross_minor)::bigint as gross_minor, count(*)::int as invoices
              from erp.ar_invoice i join erp.customer c on c.id = i.customer_id
              where (${from}::text is null or to_char(i.invoice_date, 'YYYY-MM') >= ${from})
                and (${to}::text is null or to_char(i.invoice_date, 'YYYY-MM') <= ${to})
              group by c.code, c.name, to_char(i.invoice_date, 'YYYY-MM')
              order by c.code, to_char(i.invoice_date, 'YYYY-MM')
            `,
      )
    ).rows as { code: string; name: string; period_code: string; gross_minor: string; invoices: number }[];
    const months = [...new Set(rows.map((r) => r.period_code))].sort();
    const byParty = new Map<string, { code: string; name: string; totalMinor: number; invoices: number; series: Record<string, number> }>();
    for (const r of rows) {
      const e = byParty.get(r.code) ?? { code: r.code, name: r.name, totalMinor: 0, invoices: 0, series: {} };
      e.totalMinor += Number(r.gross_minor);
      e.invoices += r.invoices;
      e.series[r.period_code] = Number(r.gross_minor);
      byParty.set(r.code, e);
    }
    const parties = [...byParty.values()].sort((a, b) => b.totalMinor - a.totalMinor);
    return { view: "counterparty", dim, from, to, months, parties };
  });

  /** Cumulative bank balance by transaction date (all bank lines — the
   * statement is the truth of cash whether or not it is matched yet).
   * The balance is always cumulative from the start of the feed; a
   * period-lens window only trims which dates are RETURNED, so the line
   * still shows the true balance within the window. */
  app.get<{ Querystring: { from?: string; to?: string } }>("/analytics/cash", async (req) => {
    const db = requireDb();
    const MONTH = /^\d{4}-\d{2}$/;
    const from = MONTH.test(req.query.from ?? "") ? req.query.from! : null;
    const to = MONTH.test(req.query.to ?? "") ? req.query.to! : null;
    const rows = (
      await db.execute(sql`
        with daily as (
          select txn_date, sum(amount_minor)::bigint as day_minor,
                 sum(sum(amount_minor)) over (order by txn_date)::bigint as balance_minor
          from erp.bank_transaction
          group by txn_date
        )
        select * from daily
        where (${from}::text is null or to_char(txn_date, 'YYYY-MM') >= ${from})
          and (${to}::text is null or to_char(txn_date, 'YYYY-MM') <= ${to})
        order by txn_date
      `)
    ).rows as { txn_date: string; day_minor: string; balance_minor: string }[];
    return {
      view: "cash",
      from,
      to,
      points: rows.map((r) => ({
        date: r.txn_date,
        dayMinor: Number(r.day_minor),
        balanceMinor: Number(r.balance_minor),
      })),
    };
  });
}

function priorPeriod(period: string): string {
  return shiftMonth(period, -1);
}

function shiftMonth(period: string, by: number): string {
  const [y, m] = period.split("-").map(Number) as [number, number];
  const d = new Date(Date.UTC(y, m - 1 + by, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** Inclusive month count: 2026-07..2026-09 → 3. */
function monthsBetween(from: string, to: string): number {
  const [fy, fm] = from.split("-").map(Number) as [number, number];
  const [ty, tm] = to.split("-").map(Number) as [number, number];
  return (ty - fy) * 12 + (tm - fm) + 1;
}
