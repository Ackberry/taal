import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { FirebaseSessions, sessionCookieName } from "@/lib/auth/session";

export default async function AccountPage() {
  const cookie = (await cookies()).get(sessionCookieName)?.value;
  if (!cookie || !await new FirebaseSessions().verify(cookie)) {
    redirect("/");
  }

  return (
    <main className="page">
      <h1>You’re signed in</h1>
    </main>
  );
}
