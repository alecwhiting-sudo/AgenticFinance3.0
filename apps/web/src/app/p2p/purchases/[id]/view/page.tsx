/** The supplier-facing view of an approved Purchase (D12): not a second
 * document, just a rendering of the record — print to PDF from the browser. */
import { getJson } from "@/lib/api";

type Detail = {
  purchase: {
    number: string;
    orderDate: string | null;
    status: string;
    lines: { lineNo: number; description: string; qty: number; unitPriceMinor: number; accountCode: string }[];
    totalMinor: number;
  };
  supplier: { name: string } | null;
};

const gbp = (minor: number) => `£${(minor / 100).toLocaleString("en-GB", { minimumFractionDigits: 2 })}`;

export default async function SupplierView({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const d = await getJson<Detail>(`/p2p/purchases/${id}`);
  if (!d) return <main>Not found.</main>;
  const p = d.purchase;
  const approved = p.status !== "requested" && p.status !== "rejected" && p.status !== "cancelled";

  return (
    <main
      className="mx-auto max-w-2xl rounded-xl border p-10 print:border-0"
      style={{ background: "var(--card)", borderColor: "var(--border)" }}
    >
      {!approved && (
        <div className="mb-6 rounded-lg border p-3 text-sm print:hidden" style={{ borderColor: "var(--warn)", color: "var(--warn)" }}>
          Not yet approved — this view becomes the purchase order when approval lands.
        </div>
      )}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-xl font-semibold" style={{ color: "var(--accent)" }}>Brightline Services plc</h1>
          <p className="text-xs" style={{ color: "var(--muted)" }}>14 Foundry Lane, Leeds LS1 4DQ</p>
        </div>
        <div className="text-right">
          <h2 className="text-lg font-semibold">PURCHASE ORDER</h2>
          <p className="text-sm">{p.number}</p>
          <p className="text-xs" style={{ color: "var(--muted)" }}>{p.orderDate ?? "—"}</p>
        </div>
      </div>
      <p className="mt-6 text-sm"><b>Supplier:</b> {d.supplier?.name}</p>
      <table className="mt-4 w-full text-sm">
        <thead>
          <tr className="border-b text-left text-xs uppercase tracking-wide" style={{ borderColor: "var(--border)", color: "var(--muted)" }}>
            <th className="py-2">Description</th>
            <th className="py-2 text-right">Qty</th>
            <th className="py-2 text-right">Unit</th>
            <th className="py-2 text-right">Amount</th>
          </tr>
        </thead>
        <tbody>
          {p.lines.map((l) => (
            <tr key={l.lineNo} className="border-b" style={{ borderColor: "var(--border)" }}>
              <td className="py-2">{l.description}</td>
              <td className="py-2 text-right tabular-nums">{l.qty}</td>
              <td className="py-2 text-right tabular-nums">{gbp(l.unitPriceMinor)}</td>
              <td className="py-2 text-right tabular-nums">{gbp(l.qty * l.unitPriceMinor)}</td>
            </tr>
          ))}
          <tr className="font-semibold">
            <td className="py-2" colSpan={3}>Order total (ex VAT)</td>
            <td className="py-2 text-right tabular-nums">{gbp(p.totalMinor)}</td>
          </tr>
        </tbody>
      </table>
      <p className="mt-6 text-xs" style={{ color: "var(--muted)" }}>
        Please reference {p.number} on all invoices and correspondence.
      </p>
    </main>
  );
}
