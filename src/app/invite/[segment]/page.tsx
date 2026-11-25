import type { Metadata } from "next";
import { notFound } from "next/navigation";
import SignInForm from "@/app/auth/sign-in-form";
import { getCurrentSession } from "@/lib/auth/session";
import { InviteRedemption } from "@/lib/events/invite-redemption";
import RedeemInvite from "./redeem-invite";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Guest invite | Taal",
  referrer: "no-referrer",
  robots: { index: false, follow: false },
};

export default async function GuestInvitePage({ params }: PageProps<"/invite/[segment]">) {
  const { segment } = await params;
  if (!await new InviteRedemption().isAvailable(segment)) notFound();

  const session = await getCurrentSession();

  return (
    <main className="page">
      <h1>Guest invite</h1>
      {session ? <RedeemInvite key={segment} segment={segment} /> : (
        <>
          <p>Sign in to open this private invite.</p>
          <SignInForm returnPath={`/invite/${segment}`} />
        </>
      )}
    </main>
  );
}
