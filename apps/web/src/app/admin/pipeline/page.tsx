import { redirect } from "next/navigation";

/** Mission control merged into the Test panel (Alec, 2026-10-03). */
export default function PipelineRedirect() {
  redirect("/test");
}
