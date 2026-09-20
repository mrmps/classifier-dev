import { useState } from "react";
import {
  User,
  ChevronsUpDown,
  Sun,
  Moon,
  BookOpen,
  LogOut,
  ArrowUpRight,
  Headset,
} from "./ui/icons";
import { Avatar, AvatarFallback } from "./ui/avatar";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
} from "./ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { AppSidebarIconTooltip } from "./shared/app-sidebar-nav-row";

/** Account identity and neutral avatar follow SMRY origin/main's
 * shared/app-sidebar-account.tsx. Auth actions use this app's session. */
export function AccountMenu({
  name,
  planLabel,
  email,
  collapsed,
  mobile,
  dark,
  setDark,
  navigate,
}: {
  name: string;
  planLabel: string;
  email: string;
  collapsed: boolean;
  mobile: boolean;
  dark: boolean;
  setDark: (dark: boolean) => void;
  navigate: (path: string) => void;
}) {
  const [signingOut, setSigningOut] = useState(false);
  const [error, setError] = useState("");
  const initials = (
    name
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((part) => part[0])
      .join("") ||
    email[0] ||
    "?"
  ).toUpperCase();
  async function signOut() {
    setSigningOut(true);
    setError("");
    try {
      const response = await fetch("/auth/sign-out", { method: "POST" });
      if (!response.ok) throw new Error("Unable to sign out");
      window.location.href = "/login";
    } catch {
      setSigningOut(false);
      setError("Could not sign out. Please try again.");
    }
  }
  return (
    <>
      <DropdownMenu>
        <AppSidebarIconTooltip
          collapsed={collapsed}
          label={`${name}, ${planLabel}`}
        >
          <DropdownMenuTrigger
            render={<button type="button" />}
            aria-label={`Open account menu: ${name}, ${planLabel}`}
            className={cn(
              "flex min-w-0 items-center gap-2 rounded-lg p-1.5 text-left transition-colors hover:bg-sidebar-accent/55 data-popup-open:bg-sidebar-accent/55 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring motion-reduce:transition-none",
              collapsed ? "size-10 justify-center p-0" : "h-12 w-full",
            )}
          >
            <Avatar className="size-9 shrink-0" aria-hidden="true">
              <AvatarFallback className="bg-sidebar-accent text-xs font-medium text-sidebar-foreground">
                {initials}
              </AvatarFallback>
            </Avatar>
            {!collapsed && (
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-[13px] font-medium leading-[18px] text-sidebar-foreground">
                  {name}
                </span>
                <span className="truncate text-xs leading-[18px] text-muted-foreground">
                  {email}
                </span>
              </span>
            )}
            {!collapsed && (
              <ChevronsUpDown className="ml-auto size-4 text-muted-foreground" />
            )}
          </DropdownMenuTrigger>
        </AppSidebarIconTooltip>
        <DropdownMenuContent
          side={mobile ? "top" : collapsed ? "right" : "top"}
          align="start"
          sideOffset={8}
          className="w-[232px] max-w-[calc(100vw-2rem)] p-1.5 [&_[data-slot=dropdown-menu-item]]:text-[13px] [&_[data-slot=dropdown-menu-item]]:min-h-9 pointer-coarse:[&_[data-slot=dropdown-menu-item]]:min-h-11 [&_[data-slot=dropdown-menu-item]]:gap-2.5 [&_[data-slot=dropdown-menu-item]]:px-2 [&_[data-slot=dropdown-menu-item]_svg]:text-muted-foreground"
        >
          <div className="mb-1 flex min-w-0 items-center gap-2.5 px-2 py-2">
            <Avatar className="size-8 shrink-0" aria-hidden="true">
              <AvatarFallback className="bg-muted text-xs font-medium">
                {initials}
              </AvatarFallback>
            </Avatar>
            <div className="flex min-w-0 flex-col gap-0.5">
              <span className="truncate text-[13px] font-medium">{name}</span>
              <span
                className="truncate text-xs text-muted-foreground"
                title={email}
              >
                {email}
              </span>
            </div>
          </div>
          <DropdownMenuGroup>
            <DropdownMenuItem onClick={() => navigate("/app/settings")}>
              <User data-icon="inline-start" />
              Account settings
            </DropdownMenuItem>
            <DropdownMenuSub>
              <DropdownMenuSubTrigger className="min-h-9 pointer-coarse:min-h-11 gap-2.5 px-2 text-[13px] [&>svg]:text-muted-foreground">
                <Sun data-icon="inline-start" />
                Appearance
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent className="min-w-36 p-1.5 [&_[role=menuitemradio]]:min-h-9 pointer-coarse:[&_[role=menuitemradio]]:min-h-11">
                <DropdownMenuGroup>
                  <DropdownMenuRadioGroup
                    value={dark ? "dark" : "light"}
                    onValueChange={(value) => setDark(value === "dark")}
                  >
                    <DropdownMenuRadioItem value="light">
                      <Sun data-icon="inline-start" />
                      Pure Light
                    </DropdownMenuRadioItem>
                    <DropdownMenuRadioItem value="dark">
                      <Moon data-icon="inline-start" />
                      Black
                    </DropdownMenuRadioItem>
                  </DropdownMenuRadioGroup>
                </DropdownMenuGroup>
              </DropdownMenuSubContent>
            </DropdownMenuSub>
            <DropdownMenuItem
              render={
                <a
                  href="https://cal.com/michaelsf/coffee"
                  target="_blank"
                  rel="noreferrer"
                />
              }
            >
              <Headset data-icon="inline-start" />
              Talk to sales
              <ArrowUpRight className="ml-auto size-3.5" />
            </DropdownMenuItem>
            <DropdownMenuItem
              render={<a href="/developers" target="_blank" rel="noreferrer" />}
            >
              <BookOpen data-icon="inline-start" />
              Documentation
              <ArrowUpRight className="ml-auto size-3.5" />
            </DropdownMenuItem>
            <DropdownMenuItem
              className="mt-3 text-destructive [&_svg]:text-destructive"
              disabled={signingOut}
              onClick={() => void signOut()}
            >
              <LogOut data-icon="inline-start" />
              {signingOut ? "Signing out…" : "Sign out"}
            </DropdownMenuItem>
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
      {error && (
        <p role="alert" className="px-2 text-xs text-destructive">
          {error}
        </p>
      )}
    </>
  );
}
