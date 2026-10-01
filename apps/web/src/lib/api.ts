/** Server-side fetch helper. Client components use NEXT_PUBLIC_API_URL. */
export const API_URL = process.env.API_URL ?? "http://localhost:3001";
export const PUBLIC_API_URL =
  process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

export async function getJson<T>(path: string): Promise<T | null> {
  try {
    const res = await fetch(`${API_URL}${path}`, { cache: "no-store" });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}
