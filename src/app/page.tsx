import { redirect } from "next/navigation";
import SignInForm from "@/app/auth/sign-in-form";
import { getCurrentSession } from "@/lib/auth/session";

export default async function HomePage() {
  if (await getCurrentSession()) redirect("/account");

  return (
    <main className="page">
      <h1>Sign in to Taal</h1>
      <SignInForm />
    </main>
  );
}
