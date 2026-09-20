import { Button } from "../components/ui/button";
import {
  createFileRoute,
  useLocation,
  useNavigate,
} from "@tanstack/react-router";
import { DashboardView } from "../features/dashboard/app-view";
import {
  getDashboard,
  dashboardAction,
} from "../features/dashboard/dashboard.functions";

export const Route = createFileRoute("/app")({
  loader: () => getDashboard(),
  component: AccountApp,
  errorComponent: ({ error }) => (
    <main className="login-page">
      <section className="login-panel">
        <h1>Your workspace awaits.</h1>
        <p>{error instanceof Error ? error.message : "Please try again."}</p>
        <Button render={<a href="/login" />}>Continue to sign in</Button>
      </section>
    </main>
  ),
});
function AccountApp() {
  const snapshot = Route.useLoaderData();
  const pathname = useLocation({
    select: (location) => location.pathname.replace(/\/$/, ""),
  });
  const navigate = useNavigate();
  return (
    <DashboardView
      pathname={pathname}
      snapshot={snapshot}
      onAction={(action) => dashboardAction({ data: action })}
      onNavigate={(path) => {
        void navigate({ to: path });
      }}
    />
  );
}
