/**
 * Guided tours (plans/DEMO_SCRIPTS.md): DATA, not wiring. The engine
 * (components/Tour.tsx) reads this registry; it highlights the sidebar
 * entry for each step's route automatically and, when a step names an
 * `anchor`, the matching `data-tour="<anchor>"` element on the page. Both
 * degrade gracefully: a missing anchor or a moved page never breaks a tour
 * — the narration card still shows and the visitor can step on.
 *
 * Roadmap rule: when a milestone ships a user-facing surface, ADD or EDIT
 * steps here (and nothing else). New journeys = new Tour entries; the
 * engine renders whatever this file declares.
 */

export type TourStep = {
  /** the page this step lives on (the engine navigates there on Next) */
  route: string;
  title: string;
  /** plain-English narration a first-time viewer can follow */
  body: string;
  /** optional in-page highlight: an element carrying data-tour="<anchor>" */
  anchor?: string;
  /** optional "try it yourself" nudge, shown under the narration */
  tryIt?: string;
};

export type Tour = {
  id: string;
  name: string;
  description: string;
  steps: TourStep[];
};

const fullLoop: Tour = {
  id: "full-loop",
  name: "The full loop",
  description:
    "Document in → agents work → humans decide → books balance → board pack out. About three minutes.",
  steps: [
    {
      route: "/",
      title: "The front door is live, not a brochure",
      body:
        "Cash with its trailing balance, the latest month's result, what the agents did TODAY and who is working right now. Everything here moves when the business moves — during a data load you can watch the run strip light up.",
      tryIt: "Note the straight-through rate: the share of invoices no human ever had to touch.",
    },
    {
      route: "/test",
      title: "The Test panel drives the demo",
      body:
        "Brightline Services plc is a generated company: 15 months of invoices, receipts, bank lines and 54 deliberately planted flaws — wrong IBANs, duplicate bills, a multi-page invoice whose stated total lies. Each scenario card says what it does, what it proves and what it costs before you run it.",
      tryIt: "“Simulate a day” is the best single button: fresh documents arrive and flow through everything you are about to see.",
    },
    {
      route: "/p2p/invoices",
      title: "Documents become data",
      body:
        "Supplier invoices arrive as PDFs, e-invoices and genuinely bad photocopies. The extraction agent (a cheap, fast model) reads each one and proposes a structured capture; clean three-way matches post straight through with no human touch.",
    },
    {
      route: "/p2p/exceptions",
      title: "The exceptions workbench — where judgement lives",
      anchor: "exception-options",
      body:
        "Anything that fails a control lands here with the evidence side by side: approved vs received vs invoiced. The agent attaches grounded, costed resolution options — including a draft supplier email you can copy out (never sent automatically). Fraud-risk holds, like a bank detail that disagrees with the master record, can ONLY be released by a human after out-of-band verification.",
      tryIt: "Open a duplicate-suspect case and expand “Draft supplier email”.",
    },
    {
      route: "/approvals",
      title: "Agents propose, humans approve",
      body:
        "Every action that moves money, posts a material journal or contacts the outside world stops here first. The approvals inbox is the human checkpoint the whole system is built around — an agent cannot skip it, whatever it thinks.",
    },
    {
      route: "/o2c",
      title: "Cash in: applied by rule, chased by agent",
      body:
        "Customer receipts auto-apply when the evidence is unambiguous. When it isn't — two invoices at the same amount, a part-payment, an unknown payer — the Cash Application Agent opens a receipt query with grounded options and a draft letter, and holds the cash for a human.",
    },
    {
      route: "/reports",
      title: "Statements with a period lens",
      body:
        "P&L, balance sheet and trial balance over any month, quarter or year-to-date window — the lens follows you across pages. Every figure drills down to the postings behind it; nothing on these statements is typed in.",
    },
    {
      route: "/reports/board",
      title: "The board pack drafts itself",
      anchor: "draft-board-pack",
      body:
        "Pick a period and the Board Reporting Agent drafts a slide deck: executive summary, P&L bridge, cash, working capital and — the differentiator — a controls slide that counts the fraud holds. The narrative is the agent's draft for your review; the charts render live from the governed views. Print gives one slide per page.",
      tryIt: "Open the latest pack and use the arrow keys to step through the slides.",
    },
    {
      route: "/analytics",
      title: "Ask the Analyst, build a page",
      body:
        "The Analyst chat (top right) answers from curated, governed views only — it cites its sources and cannot run raw SQL. Ask it to “build me a page showing supplier spend and cash” and it proposes a dashboard you confirm with one click.",
    },
    {
      route: "/agents",
      title: "Agents are staff, with staff records",
      anchor: "shadow-replay",
      body:
        "Each agent has a roster entry: workload, escalation rate, cost per completed case, latest appraisal (its eval suite). Changing an agent's instructions creates a new release that must pass its evals before promotion — and shadow replay re-runs its real recent work under the draft, in a sandboxed test book, so you see exactly what would change BEFORE you promote.",
      tryIt: "Open the Invoice Exception Agent and expand a changed case in the shadow replay report.",
    },
    {
      route: "/admin/architecture",
      title: "Under the hood",
      body:
        "The living architecture diagram — click any component for what it is and why it exists. The short version: one Postgres, an API that owns all business logic, a worker that runs the agents, and a command gateway that makes “agents propose, humans approve” structurally true rather than a policy hope.",
    },
  ],
};

export const TOURS: Tour[] = [fullLoop];
