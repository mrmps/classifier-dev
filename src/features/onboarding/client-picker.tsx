import { FieldSet, FieldLegend } from "@/components/ui/field";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
export const clients = [
  "Claude Code",
  "Codex",
  "ChatGPT",
  "Cursor",
  "Other",
] as const;

/** Names identify clients; generic UI icons are not presented as brand logos. */
export function ClientPicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <FieldSet>
      <FieldLegend>Choose your agent</FieldLegend>
      <ToggleGroup
        value={[value]}
        onValueChange={(values) => {
          if (values[0]) onChange(values[0]);
        }}
        className="flex-wrap"
        aria-label="Choose your agent"
      >
        {clients.map((name) => (
          <ToggleGroupItem key={name} value={name}>
            {name}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
    </FieldSet>
  );
}
