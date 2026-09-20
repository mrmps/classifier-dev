import { useEffect, useRef, useState } from "react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { getAgentSetupPrompt } from "../onboarding/connection-instructions";

export function HomeSetupPrompt({ demo }: { demo: boolean }) {
  const [origin, setOrigin] = useState("");
  const [dismissed, setDismissed] = useState(false);
  const [status, setStatus] = useState<"idle" | "copied" | "failed">("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => {
    setOrigin(window.location.origin);
    return () => clearTimeout(timer.current);
  }, []);
  if (dismissed) return null;
  async function copy() {
    const prompt = `Set up classifier.dev in my coding agent. Identify the client I’m using first; if you cannot determine it, ask me which client to configure.\n\n${getAgentSetupPrompt("Other", origin, demo)}`;
    try {
      await navigator.clipboard.writeText(prompt);
      setStatus("copied");
    } catch {
      setStatus("failed");
    }
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setStatus("idle"), 2400);
  }
  const feedback =
    status === "copied"
      ? "Setup prompt copied"
      : status === "failed"
        ? "Couldn’t copy. Try again."
        : "Copies a setup prompt for your AI coding tool";
  return (
    <div className="flex max-w-full items-center justify-center gap-2 self-center">
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger
            type="button"
            disabled={!origin}
            onClick={() => void copy()}
            aria-label="Onboard your agent to classifier — copy setup prompt"
            className="inline-flex min-h-9 min-w-0 flex-wrap items-center justify-center gap-x-1.5 gap-y-1 rounded-full bg-muted px-3 py-1.5 text-sm font-medium tracking-[-0.14px] text-foreground shadow-[0_0_0_1px_var(--border),0_1px_2px_rgb(0_0_0/0.05)] transition-colors hover:bg-accent focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring disabled:opacity-50"
          >
            <span>
              {status === "idle"
                ? "Onboard your agent to classifier"
                : feedback}
            </span>
            <span
              className="inline-flex shrink-0 items-center gap-1"
              aria-hidden="true"
            >
              {["claude", "codex", "cursor", "opencode"].map((name) => (
                <span
                  key={name}
                  className={`size-5 ${name === "claude" ? "bg-[#d97757]" : "bg-current"}`}
                  style={{
                    mask: `url(/icons/agents/${name}.svg) center / contain no-repeat`,
                  }}
                />
              ))}
            </span>
          </TooltipTrigger>
          <TooltipContent side="top" sideOffset={8}>
            {feedback}
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
      <button
        type="button"
        aria-label="Dismiss setup prompt"
        onClick={() => setDismissed(true)}
        className="flex size-[26px] shrink-0 items-center justify-center rounded-full bg-background text-foreground shadow-[0_0_0_1px_var(--border),0_1px_2px_rgb(0_0_0/0.05)] transition-colors hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring"
      >
        <svg
          aria-hidden="true"
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
        >
          <path d="m6 6 12 12M18 6 6 18" />
        </svg>
      </button>
      <span className="sr-only" role="status">
        {status === "idle" ? "" : feedback}
      </span>
    </div>
  );
}
