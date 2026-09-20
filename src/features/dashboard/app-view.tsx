import { Activity } from "../usage/activity";
import { ExamplePage } from "../examples/examples";
import { useCallback, useEffect, useRef, useState } from "react";
import type {
  AppSnapshot,
  AppAction,
  ActionResult,
} from "../../server/contracts";
import { PageHeader } from "../../components/page-header";
import { ToggleGroup, ToggleGroupItem } from "../../components/ui/toggle-group";
import { Field, FieldGroup } from "../../components/ui/field";
import { AppShell } from "../../components/app-shell";
import { Input } from "../../components/ui/input";
import { Button } from "../../components/ui/button";
import { Home } from "./home";
import { Onboarding } from "../onboarding/onboarding";
import { AgentCatalog } from "../agents/agent-catalog";
import { Keys } from "../keys/keys";
import { Usage } from "../usage/usage";
import { Credits } from "../billing/credits";
import { Plans } from "../billing/plans";
import { Team } from "../organizations/team";
import { OrganizationSettings } from "../organizations/organization-settings";
import { organizationAction } from "../organizations/organizations.functions";
import type { OrganizationAction } from "../../server/organization-contracts";
import { BILLING_PLANS } from "../../lib/billing";
import {
  NativeSettingsSection,
  NativeSettingsRow,
  SettingRow,
} from "../../components/shared/settings-section-primitives";
export function DashboardView({
  pathname,
  snapshot: initial,
  onAction,
  onNavigate,
}: {
  pathname: string;
  snapshot: AppSnapshot;
  onAction: (action: AppAction) => Promise<ActionResult>;
  onNavigate?: (path: string) => void;
}) {
  const [snapshot, setSnapshot] = useState(initial);
  const [dark, setDark] = useState(true);
  const [themeLoaded, setThemeLoaded] = useState(false);
  const [error, setError] = useState("");
  const workspaceRevision = useRef(0);
  useEffect(() => setSnapshot(initial), [initial]);
  useEffect(() => {
    setDark(localStorage.getItem("classifier-theme") !== "light");
    setThemeLoaded(true);
  }, []);
  useEffect(() => {
    if (!themeLoaded) return;
    document.documentElement.classList.add("theme-changing");
    document.documentElement.dataset.theme = dark ? "dark" : "light";
    document.documentElement.classList.toggle("black", dark);
    document.documentElement.classList.toggle("pure-light", !dark);
    void document.documentElement.offsetHeight;
    const frame = requestAnimationFrame(() =>
      document.documentElement.classList.remove("theme-changing"),
    );
    localStorage.setItem("classifier-theme", dark ? "dark" : "light");
    return () => cancelAnimationFrame(frame);
  }, [dark, themeLoaded]);
  const act = useCallback(
    async (action: AppAction) => {
      const revision = workspaceRevision.current;
      try {
        setError("");
        const result = await onAction(action);
        if (revision === workspaceRevision.current)
          setSnapshot(result.snapshot);
        return result;
      } catch (e) {
        if (revision === workspaceRevision.current)
          setError(
            e instanceof Error
              ? e.message
              : "Something went wrong. Please try again.",
          );
        throw e;
      }
    },
    [onAction],
  );
  async function actOnOrganization(action: OrganizationAction) {
    workspaceRevision.current++;
    await organizationAction({ data: action });
    await act({ type: "refresh" });
  }
  const workspaceId = snapshot.organizations?.active.id || snapshot.account.id;
  const navigate =
    onNavigate ||
    ((path: string) => {
      window.location.href = path;
    });
  return (
    <>
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <AppShell
        key={`shell:${workspaceId}`}
        onOrganizationAction={actOnOrganization}
        pathname={pathname}
        snapshot={snapshot}
        navigate={navigate}
        dark={dark}
        setDark={setDark}
      >
        {["/app/settings", "/app/team", "/app/organization"].includes(
          pathname,
        ) && (
          <nav
            aria-label="Settings sections"
            className="mb-6 flex flex-wrap gap-2"
          >
            {[
              ["/app/organization", "Workspace"],
              ["/app/team", "Members"],
              ["/app/settings", "Account"],
            ].map(([path, label]) => (
              <Button
                key={path}
                variant={pathname === path ? "secondary" : "ghost"}
                aria-current={pathname === path ? "page" : undefined}
                onClick={() => navigate(path)}
              >
                {label}
              </Button>
            ))}
          </nav>
        )}
        {pathname === "/app/onboarding" ? (
          <Onboarding
            snapshot={snapshot}
            act={act}
            navigate={(path) => {
              navigate(path);
            }}
          />
        ) : pathname === "/app/keys" ? (
          <Keys snapshot={snapshot} act={act} />
        ) : pathname.startsWith("/app/agents") ||
          pathname === "/app/connections" ? (
          <AgentCatalog
            snapshot={snapshot}
            act={act}
            navigate={navigate}
            clientSlug={pathname.split("/")[3]}
          />
        ) : pathname.startsWith("/app/examples") ? (
          <ExamplePage
            slug={pathname.split("/")[3]}
            demo={snapshot.demo}
            navigate={navigate}
          />
        ) : pathname === "/app/activity" ? (
          <Activity snapshot={snapshot} />
        ) : pathname === "/app/usage" ? (
          <Usage snapshot={snapshot} />
        ) : pathname === "/app/credits" ? (
          <Credits snapshot={snapshot} navigate={navigate} />
        ) : pathname === "/app/plans" ? (
          <Plans snapshot={snapshot} act={act} navigate={navigate} />
        ) : pathname === "/app/team" && snapshot.organizations ? (
          <Team
            context={snapshot.organizations}
            seatLimit={BILLING_PLANS[snapshot.billing.plan].seatLimit}
            onAction={actOnOrganization}
            navigate={navigate}
          />
        ) : pathname === "/app/organization" && snapshot.organizations ? (
          <OrganizationSettings
            context={snapshot.organizations}
            onAction={actOnOrganization}
          />
        ) : pathname === "/app/settings" ? (
          <Settings
            snapshot={snapshot}
            act={act}
            dark={dark}
            setDark={setDark}
          />
        ) : (
          <Home snapshot={snapshot} navigate={navigate} act={act} />
        )}
      </AppShell>
      {error && (
        <div role="alert" className="error-toast">
          {error}
          <button onClick={() => setError("")} aria-label="Dismiss error">
            ×
          </button>
        </div>
      )}
    </>
  );
}
function Settings({
  snapshot,
  act,
  dark,
  setDark,
}: {
  snapshot: AppSnapshot;
  act: (action: AppAction) => Promise<ActionResult>;
  dark: boolean;
  setDark: (value: boolean) => void;
}) {
  const identity = snapshot.organizations?.identity || snapshot.account;
  const [name, setName] = useState(identity.name);
  const [saved, setSaved] = useState(false);
  const [signOutError, setSignOutError] = useState("");
  const [busy, setBusy] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Settings" description="Your account and appearance." />
      <div className="flex flex-col gap-6">
        <NativeSettingsSection title="Account">
          <SettingRow title="Signed in" description={identity.email}>
            <span className="text-[13px] text-muted-foreground">
              {snapshot.demo ? "Local account" : "Personal account"}
            </span>
          </SettingRow>
          <NativeSettingsRow
            title="Display name"
            description="Shown in your workspace."
          >
            <form
              className="flex w-full items-center gap-2"
              onSubmit={async (event) => {
                event.preventDefault();
                setBusy(true);
                try {
                  await act({ type: "set-name", name });
                  setSaved(true);
                } catch {
                  /* Shared action handler displays the error toast. */
                } finally {
                  setBusy(false);
                }
              }}
            >
              <FieldGroup>
                <Field>
                  <Input
                    aria-label="Display name"
                    value={name}
                    maxLength={60}
                    required
                    onChange={(event) => {
                      setName(event.target.value);
                      setSaved(false);
                    }}
                  />
                </Field>
              </FieldGroup>
              <Button
                type="submit"
                variant="outline"
                disabled={busy || !name.trim() || name === identity.name}
              >
                {busy ? "Saving…" : saved ? "Saved" : "Save"}
              </Button>
              <span className="sr-only" role="status">
                {saved ? "Display name saved." : ""}
              </span>
            </form>
          </NativeSettingsRow>
          <SettingRow
            title="Sign out"
            description="Your API keys and usage will remain saved."
          >
            <Button
              variant="outline"
              size="sm"
              disabled={signingOut}
              onClick={async () => {
                setSigningOut(true);
                setSignOutError("");
                try {
                  const response = await fetch("/auth/sign-out", {
                    method: "POST",
                  });
                  if (!response.ok) throw new Error("Could not sign out.");
                  window.location.href = "/login";
                } catch {
                  setSignOutError("Could not sign out. Please try again.");
                  setSigningOut(false);
                }
              }}
            >
              {signingOut ? "Signing out…" : "Sign out"}
            </Button>
          </SettingRow>
        </NativeSettingsSection>
        {signOutError && (
          <p role="alert" className="error-message">
            {signOutError}
          </p>
        )}
        <NativeSettingsSection
          title="Appearance"
          description="Saved to this browser."
        >
          <NativeSettingsRow
            title="Theme"
            description="Choose Pure Light or Black."
          >
            <ToggleGroup
              aria-label="Theme"
              value={[dark ? "dark" : "light"]}
              onValueChange={(value) => {
                if (value[0]) setDark(value[0] === "dark");
              }}
              variant="outline"
            >
              <ToggleGroupItem value="light">Pure Light</ToggleGroupItem>
              <ToggleGroupItem value="dark">Black</ToggleGroupItem>
            </ToggleGroup>
          </NativeSettingsRow>
        </NativeSettingsSection>
        <NativeSettingsSection title="Data">
          <NativeSettingsRow
            title="Activity history"
            description="Usage records identify your workspace and API key. Request content can also be retained when workspace content logging is enabled."
          >
            <a
              href="/privacy"
              target="_blank"
              rel="noreferrer"
              className="text-[13px] underline underline-offset-4"
            >
              Data and privacy
            </a>
          </NativeSettingsRow>
          {snapshot.demo && (
            <NativeSettingsRow
              title="Local storage"
              description="This demo saves account data in the configured development database."
            >
              <span className="text-[13px] text-muted-foreground">
                Development database
              </span>
            </NativeSettingsRow>
          )}
        </NativeSettingsSection>
      </div>
    </div>
  );
}
