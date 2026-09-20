import { useState } from "react";
import type {
  OrganizationAction,
  OrganizationContext,
} from "@/server/organization-contracts";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field, FieldLabel } from "@/components/ui/field";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import {
  Building,
  Check,
  ChevronsUpDown,
  Plus,
  User,
} from "@/components/ui/icons";

export type OrganizationActionHandler = (
  action: OrganizationAction,
) => Promise<void>;

export function WorkspaceSwitcher({
  context,
  plan,
  onAction,
  collapsed = false,
}: {
  context: OrganizationContext;
  plan: string;
  onAction: OrganizationActionHandler;
  collapsed?: boolean;
}) {
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function run(action: OrganizationAction) {
    setBusy(true);
    setError("");
    try {
      await onAction(action);
      setCreating(false);
      setName("");
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Could not update your workspace.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={<Button variant="ghost" />}
          disabled={busy}
          className={cn(
            "h-9 min-w-0 max-w-full shrink-0 gap-2 rounded-[7px] px-2 text-sidebar-foreground pointer-coarse:min-h-11",
            collapsed ? "size-8 justify-center p-0" : "w-full justify-start",
          )}
          aria-label={`Switch workspace: ${context.active.name}`}
        >
          {context.active.kind === "personal" ? (
            <User className="size-[18px] shrink-0" strokeWidth={1.75} />
          ) : (
            <Building className="size-[18px] shrink-0" strokeWidth={1.75} />
          )}
          {!collapsed && (
            <>
              <span className="min-w-0 flex-1 truncate text-left text-[13px] font-medium">
                {context.active.name}
              </span>
              <Badge
                variant="secondary"
                className="h-5 rounded-md px-1.5 text-[10px] font-medium"
              >
                {plan}
              </Badge>
              <ChevronsUpDown className="size-3 shrink-0 text-muted-foreground" />
            </>
          )}
        </DropdownMenuTrigger>
        <DropdownMenuContent
          className="w-[232px] max-w-[calc(100vw-2rem)] p-1.5 [&_[data-slot=dropdown-menu-item]]:min-h-9 pointer-coarse:[&_[data-slot=dropdown-menu-item]]:min-h-11 [&_[data-slot=dropdown-menu-item]]:gap-2 [&_[data-slot=dropdown-menu-item]]:px-2 [&_[data-slot=dropdown-menu-item]]:text-[13px]"
          align="start"
          side={collapsed ? "right" : "bottom"}
        >
          <DropdownMenuGroup>
            {context.workspaces.map((workspace) => (
              <DropdownMenuItem
                key={workspace.id}
                onClick={() => {
                  if (workspace.id !== context.active.id)
                    void run({ type: "switch", workspaceId: workspace.id });
                }}
              >
                {workspace.kind === "personal" ? <User /> : <Building />}
                <span className="min-w-0 flex-1 truncate">
                  {workspace.name}
                </span>
                {workspace.id === context.active.id && (
                  <Check className="size-4" />
                )}
              </DropdownMenuItem>
            ))}
            <DropdownMenuItem
              className="mt-2"
              disabled
              onClick={() => {
                setError("");
                setCreating(true);
              }}
            >
              <Plus /> Create organization
            </DropdownMenuItem>
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
      <Dialog
        open={creating}
        onOpenChange={(value) => {
          if (!busy) setCreating(value);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create an organization</DialogTitle>
            <DialogDescription>
              A separate workspace for your team’s agents, keys, usage, and
              billing.
            </DialogDescription>
          </DialogHeader>
          <form
            className="flex flex-col gap-5"
            onSubmit={(event) => {
              event.preventDefault();
              void run({ type: "create", name: name.trim() });
            }}
          >
            <Field>
              <FieldLabel htmlFor="organization-name">
                Organization name
              </FieldLabel>
              <Input
                id="organization-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="Acme"
                maxLength={80}
                required
                autoFocus
              />
            </Field>
            <p className="text-xs leading-relaxed text-muted-foreground">
              Your personal keys and balance stay in your personal workspace.
            </p>
            {error && (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                disabled={busy}
                onClick={() => setCreating(false)}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={busy || !name.trim()}>
                {busy ? "Creating…" : "Create organization"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      {error && !creating && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
    </>
  );
}
