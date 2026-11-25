import { redirect } from "next/navigation";
import SignOutButton from "@/app/auth/sign-out-button";
import { getCurrentSession } from "@/lib/auth/session";

export default async function AccountPage() {
  if (!await getCurrentSession()) redirect("/");

  return (
    <main className="page">
      <h1>You’re signed in</h1>
      <SignOutButton />
    </main>
  );
}
