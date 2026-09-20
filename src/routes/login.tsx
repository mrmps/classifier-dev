import { Button } from "../components/ui/button";
import { createFileRoute } from "@tanstack/react-router";
import { ArrowRight, Lock } from "../components/ui/icons";
import { Brand } from "../components/ui/brand";

export const Route = createFileRoute("/login")({
  component: Login,
});
function Login() {
  return (
    <main className="login-page">
      <a href="/" className="login-brand">
        <Brand />
      </a>
      <section className="login-panel">
        <h1>Classification, ready for your agent.</h1>
        <p>
          Connect your tools, classify your first batch, and manage usage from
          one workspace.
        </p>
        <Button size="lg" render={<a href="/api/auth/sign-in" />}>
          Sign in or create an account <ArrowRight size={16} />
        </Button>
        <div className="login-note">
          <Lock size={16} aria-hidden="true" />A secure account for your agents.
        </div>
      </section>
      <footer>Research. Feedback. Files. Give every item a place.</footer>
    </main>
  );
}
