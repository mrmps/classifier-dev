import { createFileRoute, redirect } from "@tanstack/react-router";
import { Button } from "../components/ui/button";
import { authReturnPath } from "../lib/auth-return-path";

export const Route = createFileRoute("/login")({
  validateSearch: (search: Record<string, unknown>) => ({
    returnTo: authReturnPath(search.returnTo),
    error: search.error === "auth_failed" ? "auth_failed" : undefined,
  }),
  beforeLoad: ({ search }) => {
    if (search.error) return;
    throw redirect({ href: `/api/auth/sign-in?returnTo=${encodeURIComponent(search.returnTo)}`, reloadDocument: true });
  },
  component: LoginError,
});

function LoginError() {
  const { returnTo } = Route.useSearch();
  return (
    <main className="login-page">
      <section className="login-panel">
        <h1>We couldn’t sign you in.</h1>
        <p>Your sign-in link may have expired. Please try again.</p>
        <Button render={<a href={`/api/auth/sign-in?returnTo=${encodeURIComponent(returnTo)}`} />}>Try again</Button>
        <a href="/">Back to home</a>
      </section>
    </main>
  );
}
