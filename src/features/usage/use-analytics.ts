import { useEffect, useState } from "react";
import type {
  AccountAnalyticsResponse,
  AnalyticsKind,
} from "../../server/analytics/contracts";

/** Each filter change replaces the data; a late response cannot display another query's results. */
export function useAnalytics(
  accountId: string,
  enabled: boolean,
  kind: AnalyticsKind,
  params: Record<string, string>,
) {
  const query = JSON.stringify(params);
  const identity = `${accountId}:${kind}:${query}`;
  const [attempt, retry] = useState(0);
  const [state, setState] = useState<{
    identity: string;
    data?: AccountAnalyticsResponse;
    error?: string;
  }>({ identity: "" });
  useEffect(() => {
    if (!enabled) return;
    let active = true;
    setState({ identity });
    import("./usage.functions")
      .then(({ getUsageAnalytics }) =>
        getUsageAnalytics({ data: { kind, params: JSON.parse(query) } }),
      )
      .then(
        (data) => {
          if (active) setState({ identity, data });
        },
        () => {
          if (active)
            setState({
              identity,
              error:
                "Usage analytics are unavailable. Your balance is unaffected. Try again.",
            });
        },
      );
    return () => {
      active = false;
    };
  }, [identity, enabled, attempt]);
  const current = state.identity === identity ? state : { identity };
  return {
    ...current,
    loading: enabled && !current.data && !current.error,
    retry: () => retry((value) => value + 1),
  };
}
