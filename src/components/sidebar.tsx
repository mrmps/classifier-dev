import { formatCreditsUsd } from "@/lib/billing";
import { useEffect } from "react";
import {
  LayoutGrid,
  KeyIcon,
  Agent,
  Code,
  TrendingUp,
  CreditCard,
  BookOpen,
  Building,
  Users,
  User,
  ArrowUpRight,
  PanelLeft,
  PanelLeftClose,
} from "./ui/icons";
import { cn } from "@/lib/utils";
import type { OrganizationContext } from "@/server/organization-contracts";
import {
  WorkspaceSwitcher,
  type OrganizationActionHandler,
} from "@/features/organizations/workspace-switcher";
import { AccountMenu } from "./account-menu";
import {
  Sidebar as SidebarPrimitive,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  useSidebar,
} from "./ui/sidebar";
import {
  AppSidebarIconTooltip,
  AppSidebarNavRow,
} from "./shared/app-sidebar-nav-row";
const navigationGroups = [
  {
    label: "Build",
    links: [
      ["/app/agents", "Agents & MCP", Agent],
      ["/app/usage", "Usage", TrendingUp],
      ["/app/activity", "Activity", Code],
      ["/app/keys", "API keys", KeyIcon],
    ],
  },
  {
    label: "Workspace",
    links: [
      ["/app/credits", "Billing", CreditCard],
      ["/app/settings", "Settings", User],
    ],
  },
  {
    label: "Learn",
    links: [["/developers", "Documentation", BookOpen]],
  },
] as const;
/** App composition copied from SMRY shared/app-sidebar.tsx: 48px header,
 * compact navigation, expanding icon rail, scroll body, and fixed footer.
 * Reader-specific destinations are replaced by classifier account surfaces. */
export function Sidebar({
  name,
  email,
  dark,
  setDark,
  pathname,
  balance,
  planLabel,
  navigate,
  organizations,
  workspacePlan,
  onOrganizationAction,
}: {
  pathname: string;
  dark: boolean;
  setDark: (value: boolean) => void;
  name: string;
  email: string;
  balance: number;
  planLabel: string;
  navigate: (path: string) => void;
  organizations?: OrganizationContext;
  workspacePlan: string;
  onOrganizationAction: OrganizationActionHandler;
}) {
  const { state, isMobile, setOpenMobile, toggleSidebar } = useSidebar();
  const collapsed = state === "collapsed" && !isMobile;
  function go(path: string) {
    if (isMobile) setOpenMobile(false);
    navigate(path);
  }
  useEffect(() => {
    function key(event: KeyboardEvent) {
      const target = event.target;
      if (
        !event.defaultPrevented &&
        event.key === "[" &&
        !event.metaKey &&
        !event.ctrlKey &&
        !event.altKey &&
        !(
          target instanceof HTMLElement &&
          (target.isContentEditable ||
            target.closest("input,textarea,select,[contenteditable]"))
        )
      ) {
        event.preventDefault();
        toggleSidebar();
      }
    }
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [toggleSidebar]);
  return (
    <SidebarPrimitive
      collapsible="icon"
      className="border-r border-sidebar-border"
      aria-label="Main navigation"
    >
      <SidebarHeader
        className={cn(
          "group/sidebar-header shrink-0 items-center gap-1 px-2 py-2",
          collapsed ? "flex-col" : "h-14 flex-row",
        )}
      >
        <div
          className={cn(
            "min-w-0",
            collapsed ? "flex justify-center" : "flex-1",
          )}
        >
          {organizations ? (
            <WorkspaceSwitcher
              context={organizations}
              plan={workspacePlan}
              onAction={onOrganizationAction}
              collapsed={collapsed}
            />
          ) : (
            <div className="flex h-9 min-w-0 items-center gap-2 px-2 text-[13px] font-medium">
              <Building className="size-[18px] shrink-0" strokeWidth={1.75} />
              {!collapsed && <span className="truncate">{name}</span>}
            </div>
          )}
        </div>
        <AppSidebarIconTooltip
          collapsed
          label={
            isMobile
              ? "Close sidebar"
              : collapsed
                ? "Expand sidebar ["
                : "Collapse sidebar ["
          }
        >
          <button
            type="button"
            onClick={toggleSidebar}
            className="flex size-8 shrink-0 items-center justify-center rounded-[7px] text-sidebar-foreground/70 transition-[background-color,color] hover:bg-sidebar-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring pointer-coarse:size-11"
            aria-label={
              isMobile
                ? "Close sidebar"
                : collapsed
                  ? "Expand sidebar"
                  : "Collapse sidebar"
            }
          >
            {collapsed ? (
              <PanelLeft className="size-[18px]" strokeWidth={1.75} />
            ) : (
              <PanelLeftClose className="size-[18px]" strokeWidth={1.75} />
            )}
          </button>
        </AppSidebarIconTooltip>
      </SidebarHeader>
      <SidebarContent
        className={cn(
          "gap-4 overflow-y-auto overscroll-none px-2 py-2",
          collapsed && "items-center gap-3",
        )}
      >
        <nav
          aria-label="Account"
          className={cn(
            "flex flex-col gap-4",
            collapsed && "items-center gap-3",
          )}
        >
          <AppSidebarNavRow
            href="/app"
            icon={
              <LayoutGrid className="size-[17px] shrink-0" strokeWidth={1.75} />
            }
            label="Home"
            active={pathname === "/app" || pathname === "/app/onboarding"}
            collapsed={collapsed}
            onClick={() => {
              if (isMobile) setOpenMobile(false);
            }}
          />
          {navigationGroups.map((group) => (
            <section
              key={group.label}
              aria-label={group.label}
              className={cn("flex flex-col gap-1", collapsed && "items-center")}
            >
              {!collapsed && (
                <h2 className="flex h-5 items-center px-2 text-xs font-normal leading-none text-muted-foreground">
                  {group.label}
                </h2>
              )}
              <div className="flex flex-col gap-0.5">
                {group.links.map(([href, label, Icon]) => (
                  <AppSidebarNavRow
                    key={href}
                    href={href}
                    icon={
                      <Icon
                        className="size-[17px] shrink-0"
                        strokeWidth={1.75}
                      />
                    }
                    label={label}
                    active={
                      pathname === href ||
                      (href === "/app/agents" &&
                        pathname.startsWith("/app/agents/")) ||
                      (href === "/app/settings" &&
                        ["/app/team", "/app/organization"].includes(
                          pathname,
                        )) ||
                      (href === "/app/agents" &&
                        ["/app/connections"].includes(pathname)) ||
                      (href === "/app/credits" && pathname === "/app/plans")
                    }
                    collapsed={collapsed}
                    ariaLabel={
                      href === "/app/credits"
                        ? `Billing, ${formatCreditsUsd(balance)} available balance`
                        : undefined
                    }
                    trailing={
                      href === "/app/credits" ? (
                        <span
                          className="shrink-0 text-xs leading-none tabular-nums text-muted-foreground"
                          title="Available balance"
                        >
                          {formatCreditsUsd(balance)}
                        </span>
                      ) : href === "/developers" ? (
                        <ArrowUpRight
                          className="size-3.5 shrink-0 text-muted-foreground"
                          strokeWidth={1.75}
                        />
                      ) : undefined
                    }
                    onClick={() => {
                      if (isMobile) setOpenMobile(false);
                    }}
                  />
                ))}
              </div>
            </section>
          ))}
        </nav>
      </SidebarContent>
      <SidebarFooter
        className={cn("shrink-0 gap-0 p-2", collapsed && "items-center")}
      >
        <AccountMenu
          name={name}
          planLabel={planLabel}
          email={email}
          collapsed={collapsed}
          mobile={isMobile}
          dark={dark}
          setDark={setDark}
          navigate={go}
        />
      </SidebarFooter>
    </SidebarPrimitive>
  );
}
