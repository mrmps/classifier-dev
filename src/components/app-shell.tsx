import { BILLING_PLANS } from "@/lib/billing";
import { type OrganizationActionHandler } from "@/features/organizations/workspace-switcher";
import { useEffect, useState, type ReactNode } from "react";
import { Sidebar } from "./sidebar";
import { SidebarProvider, SidebarTrigger } from "./ui/sidebar";
import { TooltipProvider } from "./ui/tooltip";
import type { AppSnapshot } from "../server/contracts";
export function AppShell({
  children,
  pathname,
  snapshot,
  navigate,
  dark,
  setDark,
  onOrganizationAction,
}: {
  children: ReactNode;
  pathname: string;
  snapshot: AppSnapshot;
  navigate: (path: string) => void;
  dark: boolean;
  setDark: (value: boolean) => void;
  onOrganizationAction: OrganizationActionHandler;
}) {
  const [open, setOpen] = useState(true);
  const [restored, setRestored] = useState(false);
  useEffect(() => {
    try {
      setOpen(localStorage.getItem("classifier-sidebar-collapsed") !== "true");
    } catch {}
    setRestored(true);
  }, []);
  function changeOpen(value: boolean) {
    setOpen(value);
    if (restored)
      try {
        localStorage.setItem("classifier-sidebar-collapsed", String(!value));
      } catch {}
  }
  return (
    <TooltipProvider>
      <SidebarProvider
        open={open}
        onOpenChange={changeOpen}
        className="min-h-svh bg-background"
        style={
          {
            "--sidebar-width": "248px",
            "--sidebar-width-icon": "56px",
          } as React.CSSProperties
        }
      >
        <Sidebar
          imageUrl={snapshot.viewerImageUrl}
          dark={dark}
          setDark={setDark}
          pathname={pathname}
          name={snapshot.organizations?.identity.name || snapshot.account.name}
          email={
            snapshot.organizations?.identity.email || snapshot.account.email
          }
          balance={snapshot.credits.balance}
          planLabel={
            snapshot.billing.plan === "free"
              ? "Free plan"
              : `${BILLING_PLANS[snapshot.billing.plan].name} plan`
          }
          navigate={navigate}
          organizations={snapshot.organizations}
          workspacePlan={
            snapshot.billing.plan === "free"
              ? "Free"
              : BILLING_PLANS[snapshot.billing.plan].name
          }
          onOrganizationAction={onOrganizationAction}
        />
        <div className="flex min-w-0 flex-1 flex-col bg-background">
          <div className="flex h-12 items-center px-6 md:hidden">
            <SidebarTrigger />
          </div>
          <main id="main" tabIndex={-1} className="page-content w-full">
            {children}
          </main>
        </div>
      </SidebarProvider>
    </TooltipProvider>
  );
}
