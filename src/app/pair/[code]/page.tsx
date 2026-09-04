import { redirect } from "next/navigation";

/** Dealer pairing link: /pair/XR4T2Q */
export default async function PairByCode({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const clean = code.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8);
  redirect(`/join?code=${encodeURIComponent(clean)}&mode=dealer`);
}
