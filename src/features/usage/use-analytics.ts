import { useQuery } from "@tanstack/react-query";
import type {
  AccountAnalyticsResponse,
  AnalyticsKind,
} from "../../server/analytics/contracts";

/** Query keys isolate workspaces, views and filters, so late responses cannot replace another result. */
export function useAnalytics(
  accountId: string,
  enabled: boolean,
  kind: AnalyticsKind,
  params: Record<string, string>,
) {
  const query = useQuery<AccountAnalyticsResponse>({
    queryKey: ["account-analytics", accountId, kind, params],
    enabled,
    queryFn: async () => {
      const { getUsageAnalytics } = await import("./usage.functions");
      return getUsageAnalytics({ data: { workspaceId: accountId, kind, params } });
    },
  });
  return {
    data: query.data,
    error: query.isError
      ? "Usage analytics are unavailable. Your balance is unaffected. Try again."
      : undefined,
    loading: enabled && query.isPending,
    retry: () => void query.refetch(),
  };
}
