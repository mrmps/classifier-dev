"use client";

import type { ReactElement, ReactNode } from "react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { Link } from "@tanstack/react-router";

export const APP_SIDEBAR_NAV_ROW_CLASS =
  "group relative flex h-8 pointer-coarse:min-h-11 shrink-0 items-center rounded-[7px] text-left text-[13px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring";

/**
 * Shows a label tooltip for an icon-only control, but only while the sidebar is
 * collapsed (when the text label is hidden). Expanded controls render unwrapped.
 */
export function AppSidebarIconTooltip({
  collapsed,
  label,
  children,
}: {
  collapsed: boolean;
  label: string;
  children: ReactElement;
}) {
  if (!collapsed) return children;

  return (
    <Tooltip>
      <TooltipTrigger render={children} />
      <TooltipContent side="right" sideOffset={8}>
        {label}
      </TooltipContent>
    </Tooltip>
  );
}

// One icon+label sidebar entry. Collapsed -> icon-only with a hover tooltip;
// expanded -> icon + truncating label, plus an optional trailing slot (and a
// collapsed corner badge). Centralizes the collapse/active/tooltip presentation
// so each nav entry can stay focused on href/icon/label/active config.
export function AppSidebarNavRow({
  href,
  icon,
  label,
  collapsed,
  active = false,
  onClick,
  ariaLabel,
  trailing,
  collapsedBadge,
}: {
  href: string;
  icon: ReactNode;
  label: string;
  collapsed: boolean;
  active?: boolean;
  onClick?: () => void;
  /** Tooltip + collapsed aria-label; defaults to `label`. */
  ariaLabel?: string;
  /** Rendered after the label when expanded (e.g. a count badge). */
  trailing?: ReactNode;
  /** Rendered instead of the label when collapsed (e.g. a corner badge). */
  collapsedBadge?: ReactNode;
}) {
  const tooltipLabel = ariaLabel ?? label;

  return (
    <AppSidebarIconTooltip collapsed={collapsed} label={tooltipLabel}>
      <Link
        to={href}
        activeOptions={{ exact: true }}
        reloadDocument={href === "/developers"}
        onClick={onClick}
        aria-label={ariaLabel ?? (collapsed ? tooltipLabel : undefined)}
        aria-current={active ? "page" : undefined}
        data-sidebar-collapsed-center
        className={cn(
          APP_SIDEBAR_NAV_ROW_CLASS,
          collapsed ? "w-8 justify-center" : "w-full gap-2 px-2",
          active
            ? "bg-sidebar-accent text-sidebar-accent-foreground"
            : "text-sidebar-foreground/90 hover:bg-sidebar-accent/70 hover:text-sidebar-accent-foreground",
        )}
      >
        {icon}
        {collapsed ? (
          collapsedBadge
        ) : (
          <>
            <span
              data-sidebar-collapsed-hide
              className="min-w-0 flex-1 truncate"
            >
              {label}
            </span>
            {trailing}
          </>
        )}
      </Link>
    </AppSidebarIconTooltip>
  );
}
