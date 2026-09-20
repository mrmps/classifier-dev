import { Button } from "../components/ui/button";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { ArrowRight, Lock } from "../components/ui/icons";
import { Brand } from "../components/ui/brand";
import {
  getLoginInfo,
  getDashboard,
} from "../features/dashboard/dashboard.functions";

export const Route = createFileRoute("/login")({
  loader: () => getLoginInfo(),
  component: Login,
});
function Login() {
  const { demo } = Route.useLoaderData();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function login() {
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/auth/demo", { method: "POST" });
      const data = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(data.error || "Could not sign in.");
      await getDashboard();
      await navigate({
        to: "/app",
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not sign in.");
    } finally {
      setBusy(false);
    }
  }
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
        {demo ? (
          <Button size="lg" disabled={busy} onClick={login}>
            {busy ? "Opening your workspace…" : "Try the local demo"}
            <ArrowRight size={16} />
          </Button>
        ) : (
          <Button size="lg" render={<a href="/auth/sign-in" />}>
            Sign in or create an account <ArrowRight size={16} />
          </Button>
        )}
        {error && (
          <p role="alert" className="error-message">
            {error}
          </p>
        )}
        <div className="login-note">
          <Lock size={16} aria-hidden="true" />
          {demo
            ? "Local account · real classifications · no payments"
            : "A secure account for your agents."}
        </div>
        {demo && (
          <p className="login-disclosure">
            This demo saves your progress on this computer. Test inputs are sent
            to classifier.dev.
          </p>
        )}
      </section>
      <footer>Research. Feedback. Files. Give every item a place.</footer>
    </main>
  );
}
