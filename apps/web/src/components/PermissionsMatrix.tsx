import { getJson } from "@/lib/api";
import { Card, SectionTitle } from "@/components/ui";

type Matrix = {
  commands: { type: string; requiresApproval: boolean }[];
  agents: { slug: string; name: string; process: string; permissions: string[] }[];
};

/** Permissions matrix (UI_CONVENTIONS §2.3): who may propose what, and which
 * commands always stop at a human. Server component — rendered on /agents. */
export default async function PermissionsMatrix() {
  const m = await getJson<Matrix>("/agents/permissions");
  if (!m) return null;
  const agents = m.agents.filter((a) => a.permissions.length > 0);

  return (
    <Card>
      <SectionTitle>Permissions matrix — authority at a glance</SectionTitle>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b text-left" style={{ borderColor: "var(--border)", color: "var(--muted)" }}>
              <th className="py-2 pr-3 font-medium">Command</th>
              <th className="py-2 pr-3 font-medium">Checkpoint</th>
              {agents.map((a) => (
                <th key={a.slug} className="px-2 py-2 text-center font-medium" title={a.name}>
                  {a.name.replace(/ Agent$/, "")}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {m.commands.map((c) => (
              <tr key={c.type} className="border-b last:border-0" style={{ borderColor: "var(--border)" }}>
                <td className="py-1.5 pr-3 font-medium">{c.type}</td>
                <td className="py-1.5 pr-3" style={{ color: c.requiresApproval ? "var(--warn)" : "var(--muted)" }}>
                  {c.requiresApproval ? "human approves" : "standing authority"}
                </td>
                {agents.map((a) => (
                  <td key={a.slug} className="px-2 py-1.5 text-center">
                    {a.permissions.includes(c.type) ? (
                      <span style={{ color: "var(--accent)" }}>●</span>
                    ) : (
                      <span style={{ color: "var(--border)" }}>·</span>
                    )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-xs" style={{ color: "var(--muted)" }}>
        A dot means the agent&apos;s active release may <em>propose</em> that command;
        the checkpoint column says whether execution needs a human. Permissions
        change only via a new release.
      </p>
    </Card>
  );
}
