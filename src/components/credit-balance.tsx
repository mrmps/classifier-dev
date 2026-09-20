import { formatCreditsUsd } from "@/lib/billing";
export function CreditBalance({
  balance,
  included,
}: {
  balance: number;
  included: number;
}) {
  return (
    <div className="sidebar-balance">
      <div>
        <strong>{formatCreditsUsd(balance)}</strong>
        <span> available</span>
      </div>
      <div className="balance-track">
        <div
          style={{
            width: `${Math.min(100, Math.max(0, (balance / Math.max(1, included)) * 100))}%`,
          }}
        />
      </div>
      <span className="tiny muted">Shared balance</span>
    </div>
  );
}
