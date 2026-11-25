import Link from "next/link";
import { redirect } from "next/navigation";
import SignOutButton from "@/app/auth/sign-out-button";
import { getCurrentSession } from "@/lib/auth/session";
import { HostEvents } from "@/lib/events/host-events";

export default async function AccountPage() {
  const session = await getCurrentSession();
  if (!session) redirect("/");
  const isHost = await new HostEvents().isApproved(session.uid);

  return (
    <main className="page">
      <h1>You’re signed in</h1>
      {isHost && <p><Link href="/host/events">Manage your events</Link></p>}
      <SignOutButton />
    </main>
  );
}
