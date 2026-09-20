import { useState } from "react";
import { Check, Copy } from "@/components/ui/icons";
import { Button } from "./button";
export function CopyButton({
  value,
  label = "Copy",
}: {
  value: string;
  label?: string;
}) {
  const [copied, setCopied] = useState(false);
  const [failed, setFailed] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setFailed(false);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      setFailed(true);
    }
  }
  return (
    <Button variant="outline" onClick={copy}>
      {copied ? <Check size={14} /> : <Copy size={14} />}{" "}
      {failed ? "Select and copy below" : copied ? "Copied" : label}
    </Button>
  );
}
