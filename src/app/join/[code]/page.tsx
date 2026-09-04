import { redirect } from "next/navigation";

/** Shareable join link: /join/K7PM42 */
export default async function JoinByCode({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const clean = code.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8);
  redirect(`/join?code=${encodeURIComponent(clean)}`);
}
