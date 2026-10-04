/** Control-regression diff (plans/RELEASE_GOVERNANCE.md M3a). Deterministic:
 * compares two versions of a skill's text and reports operative lines that
 * were present in the old "Escalation & never-do" and "Method" sections but
 * are no longer present anywhere in the new section. A dropped prohibition,
 * tolerance or escalation trigger is a CONTROL change a human must see and
 * accept before the release ships — never something that slips through in a
 * reword. Rewording can flag too (normalised line no longer matches); that
 * is the acceptable cost: the reviewer glances and accepts, nothing is
 * silently loosened. */

const SECTIONS = ["Escalation & never-do", "Method"] as const;

function section(text: string, title: string): string | null {
  const re = new RegExp(`^## ${title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*$`, "m");
  const m = re.exec(text);
  if (!m) return null;
  const start = m.index + m[0].length;
  const next = text.slice(start).search(/^## /m);
  return next === -1 ? text.slice(start) : text.slice(start, start + next);
}

/** Normalise a line to its operative content for comparison. */
function lines(sectionText: string): string[] {
  return sectionText
    .split("\n")
    .map((l) => l.replace(/^[\s\-*\d.)]+/, "").trim().toLowerCase().replace(/\s+/g, " "))
    .filter((l) => l.length > 12); // fragments and headers carry no rule
}

export type SkillControlDiff = {
  comparable: boolean;
  /** old never-do/escalation lines with no match in the new section */
  removedNeverDo: string[];
  /** old method lines with no match in the new section */
  removedMethod: string[];
};

export function controlRegressionDiff(oldText: string, newText: string): SkillControlDiff {
  const out: SkillControlDiff = { comparable: true, removedNeverDo: [], removedMethod: [] };
  for (const title of SECTIONS) {
    const oldSec = section(oldText, title);
    const newSec = section(newText, title);
    if (oldSec === null) {
      // pre-template version: there is nothing structured to diff against
      out.comparable = false;
      continue;
    }
    const newNorm = (newSec ?? "").toLowerCase().replace(/\s+/g, " ");
    const removed = lines(oldSec).filter((l) => !newNorm.includes(l));
    if (title === "Escalation & never-do") out.removedNeverDo.push(...removed);
    else out.removedMethod.push(...removed);
  }
  return out;
}
