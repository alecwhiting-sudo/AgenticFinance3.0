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

export const firstNames = ["Sam","Priya","Jordan","Elena","Marcus","Aoife","Tom","Nadia","Chris","Yusuf","Beth","Olu","Hannah","Dev","Laura","Callum","Mei","Stefan","Ruth","Jack"] as const;
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
