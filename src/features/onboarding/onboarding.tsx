import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/page-header";
import { ConnectionSetup } from "./connection-setup";
import type { AppSnapshot, AppAction, ActionResult } from "@/server/contracts";
export function Onboarding({
  snapshot,
  act,
  navigate,
}: {
  snapshot: AppSnapshot;
  act: (action: AppAction) => Promise<ActionResult>;
  navigate: (path: string) => void;
}) {
  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title="How will you use classifier?"
        description="Give an agent a new tool, or add classification to your application."
        action={
          <Button variant="ghost" onClick={() => navigate("/app")}>
            {snapshot.onboarding.completed
              ? "Back to overview"
              : "Skip to overview"}
          </Button>
        }
      />
      <ConnectionSetup
        snapshot={snapshot}
        act={act}
        onDone={() => navigate("/app")}
      />
    </div>
  );
}
