import { useEffect, useState } from "react";
import { isAxiosError } from "axios";
import { fetchResourceList, watchResourceList, type SecretSummary } from "../api";
import { applyK8sNamespacedWatchEvent } from "../resourceList/watchEventReducer";

const emptyItems: SecretSummary[] = [];

export function useSecretsList(
  clusterId: string | null,
  namespace: string,
  scopeKey: string,
  revision: number,
  pageVisible: boolean,
  syncServerClock: (time?: number) => void,
) {
  const [state, setState] = useState<{
    scopeKey: string;
    items: SecretSummary[];
    loading: boolean;
    error: string | null;
  }>({ scopeKey: "", items: emptyItems, loading: false, error: null });

  useEffect(() => {
    if (!clusterId || !pageVisible) return;
    const controller = new AbortController();
    let stopWatch: (() => void) | undefined;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;

    const load = async (retry = false) => {
      setState((prev) => ({
        scopeKey,
        items: prev.scopeKey === scopeKey ? prev.items : emptyItems,
        loading: !retry,
        error: retry ? prev.error : null,
      }));
      try {
        const { items, serverTimeMs, resourceVersion } = await fetchResourceList<SecretSummary>(
          clusterId, "secrets", namespace, controller.signal,
        );
        if (controller.signal.aborted) return;
        syncServerClock(serverTimeMs);
        setState({ scopeKey, items, loading: false, error: null });
        stopWatch = watchResourceList<SecretSummary>(clusterId, "secrets", namespace, {
          resourceVersion,
          onEvent: (event) => {
            if (controller.signal.aborted) return;
            syncServerClock(event.serverTimeMs);
            setState((prev) => ({
              ...prev,
              items: applyK8sNamespacedWatchEvent(prev.items, event, namespace),
            }));
          },
          onDisconnect: (status) => {
            if (controller.signal.aborted) return;
            if (status === 401 || status === 403 || status === 404) {
              setState((prev) => ({
                ...prev,
                error: status === 403 ? "当前账号没有 watch secrets 权限" : "无法订阅 Secrets 更新",
              }));
              return;
            }
            retryTimer = setTimeout(() => void load(true), 1000);
          },
        });
      } catch (err) {
        if (controller.signal.aborted) return;
        const status = isAxiosError(err) ? err.response?.status : undefined;
        setState({
          scopeKey,
          items: emptyItems,
          loading: false,
          error: status === 403 ? "当前账号没有 list secrets 权限"
            : status === 404 ? "集群不存在或 Secrets 接口不可用"
              : "加载 Secrets 失败",
        });
        if (retry && (status === undefined || status >= 500)) {
          retryTimer = setTimeout(() => void load(true), 3000);
        }
      }
    };

    void load();
    return () => {
      controller.abort();
      stopWatch?.();
      clearTimeout(retryTimer);
    };
  }, [clusterId, namespace, scopeKey, revision, pageVisible, syncServerClock]);

  return state.scopeKey === scopeKey
    ? state
    : { items: emptyItems, loading: !!clusterId, error: null };
}
