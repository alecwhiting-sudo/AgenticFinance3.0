/** Curated name/content pools: the "business story" the generator weaves from.
 * These are the deterministic stand-in for LLM narrative generation; an
 * optional LLM enrichment pass can rewrite email bodies later. */

export const supplierNames = [
  "Northgate Office Supplies Ltd","CloudPeak Hosting Ltd","Fenwick & Marsh Accountants LLP","Hartley Print & Packaging","Metro Workspace (Leeds) Ltd","Ashdown IT Services","Bricknell Facilities Group","Calder Courier Co","Dentonware Software Ltd","Eastfield Energy Supply","Foxglove Marketing Studio","Gillingham Legal Partners","Harrier Travel Management","Ironbridge Components Ltd","Juniper Catering Co","Kestrel Insurance Brokers","Lambourne Training Associates","Mercia Telecoms Ltd","Nineladies Data Services","Oakhurst Vehicle Leasing","Pennine Security Systems","Quayside Recruitment","Rowanfield Cleaning Services","Silverbeck Stationers","Thornbury Web Design","Ullswater Logistics","Vantage Office Interiors","Wrenfield Market Research","Yarrow Health & Safety Ltd","Zetland Print Finishing","Alderbrook Consulting","Birchmoor Electrical","Cresswell Audio Visual","Dunholme Archive Storage","Elmswell Payroll Bureau","Farrier & Sons Maintenance","Greywell Analytics Ltd","Holloway Business Media","Ingleton Office Plants","Jessop Event Hire",
] as const;

export const customerNames = [
  "Ashford Retail Group plc","Bluebird Logistics Ltd","Carden Health Partners","Dunmore Estates Ltd","Eastgate Manufacturing plc","Fairlight Hotels Group","Garsdale Foods Ltd","Haverton Insurance Services","Islingworth Council","Jarrow Marine Engineering","Kelfield Pharmaceuticals","Lydgate Property Management","Marwood Construction plc","Netherby Financial Advisers","Ouseburn Breweries","Palmerston Education Trust","Quarry Bank Textiles","Redmayne Sports Group","Stanhope Dental Chain","Tarnbrook Utilities","Underwood Veterinary Group","Verity Media Productions","Wexcombe Garden Centres","Yeavering Tech Campus","Zeals Automotive Ltd","Aldwark Shipping Agency","Bexfield Care Homes","Cotherstone Analytics","Danesmoor Energy","Ebberston Airport Services","Farndale Publishing","Grassington Outdoor Wear","Hutton Rudby Robotics","Ingleby Catering Group","Juniper Lane Interiors","Kirkhammer Steel","Lealholm Transport","Middleham Racing Supplies","Nunthorpe Solar","Osmotherley Gins","Pickhill Software","Ruswarp Fisheries","Sinnington Events","Thixendale Farm Foods","Ugthorpe Haulage","Welburn Opticians Group","Yearsley Cold Storage","Ampleforth Digital","Boltby Drone Services","Crayke Data Centres","Danby Wiske Architects","Easingwold Law","Fadmoor Renewables","Gilling East Media","Helmsley Outdoor Events","Kilburn Joinery Group","Levisham Rail Services","Muker Wool Co","Nawton Vehicle Hire","Oldstead Hospitality",
] as const;

export const serviceItems = [
  ["SVC-001","Consulting day — principal","service",95000],
  ["SVC-002","Consulting day — associate","service",65000],
  ["SVC-003","Managed service — monthly","service",250000],
  ["SVC-004","Data pipeline build — fixed fee","service",480000],
  ["SVC-005","Finance systems review","service",320000],
  ["SVC-006","Agent workshop — half day","service",85000],
  ["SVC-007","Reporting automation sprint","service",260000],
  ["SVC-008","Support retainer — monthly","service",120000],
] as const;

export const productItems = [
  ["PRD-001","Starter analytics pack","good",120000],
  ["PRD-002","Reporting template bundle","good",45000],
  ["PRD-003","Forecast model licence","good",180000],
  ["PRD-004","Dashboard starter kit","good",95000],
  ["PRD-005","Close checklist toolkit","good",38000],
  ["PRD-006","KPI library","good",52000],
] as const;

/** What suppliers bill Brightline for (expense account code, description pool, price band in pence). */
export const supplyCategories = [
  { account: "6200", label: "Software subscription", items: ["Cloud hosting — monthly","CRM licences x10","Observability platform","Password manager — team","CI runner minutes","Design tool seats"], band: [12000, 260000] },
  { account: "6100", label: "Facilities", items: ["Office rent — monthly","Meeting room hire","Office cleaning — monthly","Electricity Q bill","Desk hire x4"], band: [45000, 520000] },
  { account: "6500", label: "Professional fees", items: ["Quarterly accounts review","Employment law advice","Trademark renewal","Insurance premium","Payroll bureau — monthly"], band: [30000, 420000] },
  { account: "6400", label: "Marketing", items: ["Campaign management — monthly","Conference stand","Print run — brochures","Webinar platform","Sponsored newsletter"], band: [18000, 350000] },
  { account: "6300", label: "Travel", items: ["Rail travel — client visits","Hotel — 2 nights","Mileage reimbursement batch","Flights — partner summit"], band: [8000, 120000] },
  { account: "6900", label: "Office costs", items: ["Stationery order","Coffee & kitchen supplies","Office chairs x2","Monitor arms x4","First aid restock","Courier & postage batch","Office plant maintenance — quarterly","Print & finishing order","AV equipment hire"], band: [4000, 90000] },
  { account: "5000", label: "Delivery subcontract", items: ["Associate subcontract — days","Specialist data engineering","QA testing support","Design subcontract"], band: [60000, 700000] },
] as const;

/** Trade-plausible line items PER SUPPLIER (2026-11-20, Alec: "suppliers
 * should be invoicing for plausible things"). Each list MUST be exactly the
 * same length as its supplier's category pool above — labels are picked by
 * index from a same-sized array, so the RNG stream, every planted exception
 * and the whole dataset structure are unchanged; only the words differ.
 * A supplier without an entry falls back to its category's generic pool. */
export const supplierItems: Record<string, readonly string[]> = {
  // 6200 Software & IT (pool of 6)
  "CloudPeak Hosting Ltd": ["Cloud hosting — monthly", "Object storage — monthly", "CDN bandwidth", "Managed database tier", "Load balancer add-on", "Backup storage — monthly"],
  "Ashdown IT Services": ["Managed IT support — monthly", "Helpdesk contract", "Laptop builds x3", "Network maintenance visit", "Microsoft 365 licences x10", "Server patching window"],
  "Dentonware Software Ltd": ["CRM licences x10", "Accounting software seats", "API usage overage", "Premium support plan", "Sandbox environment", "Licence true-up"],
  "Mercia Telecoms Ltd": ["Business broadband — monthly", "Mobile fleet x12 — monthly", "VoIP seats x20", "Leased line — monthly", "Handset upgrades x4", "Conferencing add-on"],
  "Nineladies Data Services": ["Data pipeline support — monthly", "Data quality audit", "Warehouse compute credits", "Dashboard maintenance", "Dataset licence — quarterly", "Schema migration work"],
  "Thornbury Web Design": ["Website maintenance — monthly", "Landing page build", "SEO technical fixes", "Accessibility audit", "Plugin licences — annual", "Site speed optimisation"],
  "Greywell Analytics Ltd": ["Analytics platform — monthly", "Attribution model build", "Tracking audit", "Custom report pack", "Data studio dashboards", "Event taxonomy review"],
  // 6100 Facilities (pool of 5)
  "Metro Workspace (Leeds) Ltd": ["Office rent — monthly", "Meeting room hire", "Desk hire x4", "Service charge — quarterly", "Car park spaces x2"],
  "Bricknell Facilities Group": ["Planned maintenance visit", "HVAC service — quarterly", "Waste collection — monthly", "Washroom services — monthly", "Pest control visit"],
  "Eastfield Energy Supply": ["Electricity Q bill", "Gas Q bill", "Standing charges — quarterly", "EV charger electricity", "Half-hourly meter rental"],
  "Pennine Security Systems": ["Alarm monitoring — monthly", "CCTV maintenance visit", "Access control fobs x10", "Keyholding — monthly", "Out-of-hours alarm callout"],
  "Rowanfield Cleaning Services": ["Office cleaning — monthly", "Deep clean — quarterly", "Window cleaning", "Carpet clean — meeting rooms", "Cleaning consumables restock"],
  "Vantage Office Interiors": ["Meeting room refit", "Desk reconfiguration", "Acoustic panels x6", "Reception refresh", "Storage wall install"],
  "Birchmoor Electrical": ["PAT testing — annual", "Lighting replacement", "Distribution board inspection", "Emergency lighting test", "Socket installs x6"],
  "Dunholme Archive Storage": ["Archive box storage — monthly", "Retrieval requests batch", "Secure shredding", "New box intake", "Indexing service"],
  "Farrier & Sons Maintenance": ["Reactive repair visit", "Planned maintenance — monthly", "Door hardware replacement", "Gutter clearance", "Decorating — meeting room"],
  "Ingleton Office Plants": ["Plant maintenance — monthly", "Seasonal display refresh", "New planters x4", "Living wall service", "Replacement plants batch"],
  // 6500 Professional fees (pool of 5)
  "Fenwick & Marsh Accountants LLP": ["Quarterly accounts review", "Year-end accounts preparation", "VAT return review", "Management accounts support", "Corporation tax computation"],
  "Gillingham Legal Partners": ["Employment law advice", "Contract review — supplier MSA", "Trademark renewal", "Data protection advice", "Shareholder agreement amendment"],
  "Kestrel Insurance Brokers": ["Combined policy premium", "Professional indemnity renewal", "Cyber cover premium", "Policy mid-term adjustment", "Broker service fee"],
  "Lambourne Training Associates": ["Management training day", "First aid training x6", "Onboarding workshop", "Compliance e-learning seats", "Presentation skills course"],
  "Quayside Recruitment": ["Permanent placement fee", "Contractor margin — monthly", "Advertised search campaign", "Temp cover — week", "Retained search instalment"],
  "Elmswell Payroll Bureau": ["Payroll bureau — monthly", "Auto-enrolment administration", "P11D preparation", "Payroll year-end run", "Starter/leaver processing batch"],
  "Yarrow Health & Safety Ltd": ["H&S audit — annual", "Fire risk assessment", "DSE assessments x10", "Safety training session", "Policy review & update"],
  // 6400 Marketing (pool of 5)
  "Foxglove Marketing Studio": ["Campaign management — monthly", "Brand refresh concepts", "Social content pack", "Email campaign build", "Creative retainer — monthly"],
  "Wrenfield Market Research": ["Customer survey wave", "Focus groups x2", "Market sizing study", "NPS tracking — quarterly", "Competitor landscape review"],
  "Holloway Business Media": ["Sponsored newsletter", "Trade press advertorial", "Podcast sponsorship — monthly", "Display campaign", "Webinar promotion"],
  "Jessop Event Hire": ["Conference stand build", "Event AV package", "Furniture hire — launch event", "Exhibition build day", "Marquee & staging hire"],
  // 6300 Travel (pool of 4)
  "Harrier Travel Management": ["Rail travel — client visits", "Hotel — 2 nights", "Flights — partner summit", "Booking service fee — monthly"],
  "Oakhurst Vehicle Leasing": ["Vehicle lease — monthly", "Excess mileage charge", "Lease vehicle service & tyres", "Vehicle delivery & collection"],
  // 6900 Office costs (pool of 9)
  "Northgate Office Supplies Ltd": ["Stationery order", "Copier paper — bulk", "Toner cartridges x4", "Office chairs x2", "Monitor arms x4", "Desk accessories batch", "Whiteboards x2", "Mailroom supplies", "Branded notebooks"],
  "Hartley Print & Packaging": ["Print run — brochures", "Business cards x500", "Letterheads — bulk", "Branded packaging boxes", "Poster printing", "Exhibition graphics", "Label roll stock", "Presentation folders", "Envelope print run"],
  "Calder Courier Co": ["Courier & postage batch", "Same-day courier x3", "Next-day parcels batch", "International shipment", "Weekly collection service", "Packaging consumables", "Timed delivery — contracts", "Pallet shipment", "Returns handling batch"],
  "Juniper Catering Co": ["Coffee & kitchen supplies", "Boardroom lunch x12", "All-hands breakfast", "Client meeting catering", "Fruit baskets — weekly", "Quarterly social catering", "Sandwich platters x6", "Barista cart — event", "Kitchen consumables restock"],
  "Silverbeck Stationers": ["Stationery order", "Archive boxes x20", "Diaries & planners — annual", "Pens & markers batch", "Filing supplies", "Shredder sacks", "Laminating pouches", "Label printer rolls", "Desk trays x8"],
  "Ullswater Logistics": ["Weekly pallet collection", "Warehouse cross-dock fee", "Dedicated van — day rate", "Fuel surcharge — monthly", "Storage pallet spaces", "Last-mile deliveries batch", "Goods-in handling", "Freight insurance", "Returns consolidation"],
  "Zetland Print Finishing": ["Print & finishing order", "Binding — reports x40", "Foiling & embossing run", "Laminating — presentation sets", "Die-cut job", "Booklet stitching run", "Trimming & packing", "Proof set production", "Spot UV run"],
  "Cresswell Audio Visual": ["AV equipment hire", "Boardroom AV maintenance", "Projector lamp replacement", "Video conferencing install", "Event PA hire", "Digital signage — monthly", "Microphone kit hire", "AV technician — day rate", "Cable & mount sundries"],
  // 5000 Delivery subcontract (pool of 4)
  "Ironbridge Components Ltd": ["Component supply — project", "Machined parts batch", "Prototype fabrication", "Tooling supply"],
  "Alderbrook Consulting": ["Associate subcontract — days", "Discovery phase — consulting", "Implementation support — days", "Advisory retainer — monthly"],
};

/** The line-item pool for a supplier: its own trade-plausible labels when
 * defined, else the category's generic pool. Throws at generation time if a
 * supplier list drifts from its category's length — that would shift the
 * RNG index space and silently move every plant. */
export function itemsFor(supplierName: string, cat: { items: readonly string[] }): readonly string[] {
  const own = supplierItems[supplierName];
  if (!own) return cat.items;
  if (own.length !== cat.items.length)
    throw new Error(`supplierItems["${supplierName}"] has ${own.length} labels; its category pool has ${cat.items.length} — lengths must match to keep the RNG stream stable`);
  return own;
}

export const firstNames =["Sam","Priya","Jordan","Elena","Marcus","Aoife","Tom","Nadia","Chris","Yusuf","Beth","Olu","Hannah","Dev","Laura","Callum","Mei","Stefan","Ruth","Jack"] as const;
export const lastNames = ["Okafor","Hughes","Patel","Kowalski","Brennan","Shah","Whitfield","Nakamura","Osei","Lindqvist","Carter","Begum","Doyle","Marsh","Novak","Reid","Sousa","Tanaka","Udo","Vance"] as const;

export const emailOpeners = [
  "Hope you're well.","Thanks for your continued business.","Following up on our recent order.","As discussed on the call,","Quick one from our side —","Please see the attached.",
] as const;
export const emailClosers = [
  "Any questions, just reply to this email.","Thanks as always.","Appreciate a prompt turnaround.","Let us know if anything is unclear.","Best regards",
] as const;

export const disputePhrases = [
  "we believe the quantity billed does not match what was delivered",
  "the unit price differs from the agreed schedule",
  "we cannot locate a matching purchase order on our side",
  "this appears to duplicate an earlier invoice",
] as const;

/** Keyword → expense account, so a supplier's bills suit its name. First match wins. */
export const categoryKeywords: [RegExp, string][] = [
  [/hosting|software|data|web design|analytics|telecoms|it services|digital/i, "6200"],
  [/workspace|facilities|cleaning|security|interiors|electrical|maintenance|energy|storage|office plants/i, "6100"],
  [/accountant|legal|insurance|payroll|recruitment|health & safety|training/i, "6500"],
  [/marketing|media|market research|event/i, "6400"],
  [/travel|vehicle leasing/i, "6300"],
  [/consulting|components/i, "5000"],
  [/courier|logistics|stationer|catering|print|supplies|audio visual|archive/i, "6900"],
];
