import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  deleteInContainer,
  downloadContainerArchiveBlob,
  downloadContainerFilesUrl,
  listContainerFiles,
  mkdirInContainer,
  renameInContainer,
  uploadContainerFile,
  type ContainerFileEntry,
} from "../api";
import {
  FileTransferTasksPanel,
  formatTransferBytes,
  type TransferTask,
} from "./FileTransferTasksPanel";

type Props = {
  clusterId: string;
  namespace: string;
  pod: string;
  container: string;
  /** 初始路径；若提供 path/onPathChange，则作为受控组件由外部管理 */
  defaultPath?: string;
  path?: string;
  onPathChange?: (p: string) => void;
  onToast?: (msg: string) => void;
};

function joinPath(dir: string, name: string): string {
  if (!dir) return name;
  if (dir === "/") return `/${name}`;
  return `${dir.replace(/\/+$/, "")}/${name}`;
}

function parentPath(p: string): string {
  const clean = (p || "/").replace(/\/+$/, "") || "/";
  if (clean === "/") return "/";
  const idx = clean.lastIndexOf("/");
  if (idx <= 0) return "/";
  return clean.slice(0, idx) || "/";
}

export const FileManagerPanel: React.FC<Props> = ({
  clusterId,
  namespace,
  pod,
  container,
  defaultPath = "/",
  path,
  onPathChange,
  onToast,
}) => {
  const [innerPath, setInnerPath] = useState(defaultPath);
  const currentPath = path ?? innerPath;
  const setCurrentPath = useCallback(
    (p: string) => {
      if (onPathChange) onPathChange(p);
      else setInnerPath(p);
    },
    [onPathChange],
  );
  const [pathInput, setPathInput] = useState(currentPath);
  const [addressBarMode, setAddressBarMode] = useState<"breadcrumb" | "edit">("breadcrumb");
  const [items, setItems] = useState<ContainerFileEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const addressInputRef = useRef<HTMLInputElement | null>(null);
  const [transferTasks, setTransferTasks] = useState<TransferTask[]>([]);
  const skipAddressBlurRef = useRef(false);
  // 仅用于区分：地址栏手动确认路径后的跳转失败，需要显示更友好的固定提示语
  const manualEnterPendingRef = useRef(false);

  useEffect(() => {
    const init = path ?? defaultPath;
    setInnerPath(init);
    setPathInput(init);
    setSelected({});
    setAddressBarMode("breadcrumb");
  }, [clusterId, namespace, pod, container, defaultPath, path]);

  useEffect(() => {
    setPathInput(currentPath);
  }, [currentPath]);

  const enterAddressEditMode = useCallback(() => {
    setPathInput(currentPath);
    setAddressBarMode("edit");
  }, [currentPath]);

  useEffect(() => {
    if (addressBarMode !== "edit") return;
    const id = requestAnimationFrame(() => {
      const el = addressInputRef.current;
      if (!el) return;
      el.focus();
      el.select();
    });
    return () => cancelAnimationFrame(id);
  }, [addressBarMode]);

  const commitPathFromAddressInput = useCallback(() => {
    skipAddressBlurRef.current = true;
    const next = pathInput.trim() || "/";
    manualEnterPendingRef.current = true;
    setCurrentPath(next);
    setAddressBarMode("breadcrumb");
    queueMicrotask(() => {
      skipAddressBlurRef.current = false;
    });
  }, [pathInput, setCurrentPath]);

  const cancelAddressEdit = useCallback(() => {
    setPathInput(currentPath);
    setAddressBarMode("breadcrumb");
  }, [currentPath]);

  const onAddressBarBlur = useCallback(() => {
    if (skipAddressBlurRef.current) return;
    cancelAddressEdit();
  }, [cancelAddressEdit]);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await listContainerFiles(clusterId, namespace, pod, container, currentPath);
      setItems(res.items || []);
      setSelected({});
    } catch (e: any) {
      if (manualEnterPendingRef.current) {
        setError("路径不存在，请检查");
      } else {
        setError(e?.response?.data?.error ?? e?.message ?? "加载目录失败");
      }
    } finally {
      manualEnterPendingRef.current = false;
      setLoading(false);
    }
  }, [clusterId, namespace, pod, container, currentPath]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const selectedPaths = useMemo(() => {
    const names = Object.keys(selected).filter((k) => selected[k]);
    return names.map((name) => joinPath(currentPath, name));
  }, [selected, currentPath]);

  /** 勾选项在当前列表中的 size 之和；任一项缺失或 size&lt;0 则不做 tar 进度估算 */
  const selectedListBytesForTarEstimate = useMemo(() => {
    const names = new Set(Object.keys(selected).filter((k) => selected[k]));
    if (names.size === 0) return { ok: false as const, bytes: 0 };
    let sum = 0;
    for (const n of names) {
      const it = items.find((i) => i.name === n);
      if (!it || it.size < 0) return { ok: false as const, bytes: 0 };
      sum += it.size;
    }
    if (sum <= 0) return { ok: false as const, bytes: 0 };
    return { ok: true as const, bytes: sum };
  }, [items, selected]);

  const canRename = useMemo(() => Object.keys(selected).filter((k) => selected[k]).length === 1, [selected]);

  const breadcrumbs = useMemo(() => {
    const clean = (currentPath || "/").replace(/\/+$/, "") || "/";
    if (clean === "/") return [{ name: "/", path: "/" }];
    const parts = clean.split("/").filter(Boolean);
    const crumbs: Array<{ name: string; path: string }> = [{ name: "/", path: "/" }];
    let acc = "";
    parts.forEach((p) => {
      acc += `/${p}`;
      crumbs.push({ name: p, path: acc });
    });
    return crumbs;
  }, [currentPath]);

  const toggleAll = (checked: boolean) => {
    const next: Record<string, boolean> = {};
    items.forEach((it) => {
      next[it.name] = checked;
    });
    setSelected(next);
  };

  const sizeText = (n: number) => {
    if (n == null || n < 0) return "-";
    if (n < 1024) return `${n}B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)}KB`;
    if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)}MB`;
    return `${(n / (1024 * 1024 * 1024)).toFixed(1)}GB`;
  };

  const removeTransferTask = useCallback((id: string) => {
    setTransferTasks((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const scheduleRemoveTransferTask = useCallback(
    (id: string) => {
      window.setTimeout(() => removeTransferTask(id), 12000);
    },
    [removeTransferTask],
  );

  const newTaskId = () =>
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

  const doDownload = async () => {
    if (selectedPaths.length === 0) return;
    const estimateBytes = selectedListBytesForTarEstimate.ok
      ? selectedListBytesForTarEstimate.bytes
      : 0;
    const label =
      selectedPaths.length === 1
        ? selectedPaths[0].replace(/^.*\//, "") || "download.tar"
        : `打包 ${selectedPaths.length} 项 → weblens-files-${pod}.tar`;
    const id = newTaskId();
    const initialBasis = estimateBytes > 0 ? "estimated" : "unknown";
    setTransferTasks((prev) => [
      ...prev,
      {
        id,
        kind: "download",
        label,
        status: "running",
        percent: estimateBytes > 0 ? 0 : null,
        loaded: 0,
        total: null,
        downloadBasis: initialBasis,
        estimateTotalBytes: estimateBytes > 0 ? estimateBytes : undefined,
        detail:
          estimateBytes > 0
            ? `列表原始总大小 ${formatTransferBytes(estimateBytes)}，将用于估算进度\ntar 流式响应通常无 Content-Length`
            : "正在连接…\n流式打包，无总大小可用于估算（勾选项含未知大小或总大小为 0）",
      },
    ]);
    const url = downloadContainerFilesUrl(clusterId, namespace, pod, container, selectedPaths);
    try {
      const blob = await downloadContainerArchiveBlob(url, {
        onProgress: ({ loaded, total: clTotal }) => {
          if (clTotal != null && clTotal > 0) {
            const pct = Math.min(99, Math.round((loaded / clTotal) * 100));
            setTransferTasks((prev) =>
              prev.map((t) =>
                t.id === id
                  ? {
                      ...t,
                      downloadBasis: "exact",
                      total: clTotal,
                      loaded,
                      percent: pct,
                      estimateTotalBytes: undefined,
                      detail: `真实进度（HTTP Content-Length：${formatTransferBytes(clTotal)}）`,
                    }
                  : t,
              ),
            );
            return;
          }
          if (estimateBytes > 0) {
            const raw = loaded / estimateBytes;
            const barPct = raw >= 1 ? 97 : Math.min(97, Math.round(raw * 100));
            setTransferTasks((prev) =>
              prev.map((t) =>
                t.id === id
                  ? {
                      ...t,
                      downloadBasis: "estimated",
                      estimateTotalBytes: estimateBytes,
                      loaded,
                      total: null,
                      percent: barPct,
                      detail: `已接收 ${formatTransferBytes(loaded)} / ${formatTransferBytes(estimateBytes)}（估算）\n流式打包中，按原始文件大小估算`,
                    }
                  : t,
              ),
            );
            return;
          }
          setTransferTasks((prev) =>
            prev.map((t) =>
              t.id === id
                ? {
                    ...t,
                    downloadBasis: "unknown",
                    loaded,
                    total: null,
                    percent: null,
                    estimateTotalBytes: undefined,
                    detail: `已接收 ${loaded.toLocaleString()} 字节\n流式打包，无总大小`,
                  }
                : t,
            ),
          );
        },
      });
      const href = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = href;
      a.download = `weblens-files-${pod}.tar`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(href);
      setTransferTasks((prev) =>
        prev.map((t) => {
          if (t.id !== id) return t;
          const basis = t.downloadBasis;
          let detail: string;
          if (basis === "exact") {
            detail = "已触发浏览器保存（真实进度 · Content-Length）";
          } else if (basis === "estimated") {
            detail =
              "已触发浏览器保存。tar 实际体积可能大于或小于列表估算（压缩、头信息、目录条目等）";
          } else {
            detail = "已触发浏览器保存（流式打包，无总大小）";
          }
          return {
            ...t,
            status: "success",
            loaded: blob.size,
            total: blob.size,
            percent: basis === "unknown" ? null : 100,
            detail,
          };
        }),
      );
      onToast?.("下载完成");
      scheduleRemoveTransferTask(id);
    } catch (e: any) {
      const msg = e?.message ?? "下载失败";
      setTransferTasks((prev) =>
        prev.map((t) =>
          t.id === id
            ? {
                ...t,
                status: "error",
                percent: null,
                detail: msg,
              }
            : t,
        ),
      );
      scheduleRemoveTransferTask(id);
    }
  };

  const doDelete = async () => {
    if (selectedPaths.length === 0) return;
    if (!window.confirm(`确定删除已勾选的 ${selectedPaths.length} 项吗？`)) return;
    try {
      await deleteInContainer(clusterId, namespace, pod, container, selectedPaths);
      onToast?.("删除成功");
      refresh();
    } catch (e: any) {
      setError(e?.response?.data?.error ?? e?.message ?? "删除失败");
    }
  };

  const doRename = async () => {
    const one = Object.keys(selected).find((k) => selected[k]);
    if (!one) return;
    const nextName = window.prompt("重命名为：", one);
    if (!nextName || !nextName.trim() || nextName.trim() === one) return;
    try {
      await renameInContainer(
        clusterId,
        namespace,
        pod,
        container,
        joinPath(currentPath, one),
        joinPath(currentPath, nextName.trim()),
      );
      onToast?.("重命名成功");
      refresh();
    } catch (e: any) {
      setError(e?.response?.data?.error ?? e?.message ?? "重命名失败");
    }
  };

  const doMkdir = async () => {
    const name = window.prompt("新建文件夹名称：", "new-folder");
    if (!name || !name.trim()) return;
    try {
      await mkdirInContainer(clusterId, namespace, pod, container, joinPath(currentPath, name.trim()));
      onToast?.("文件夹已创建");
      refresh();
    } catch (e: any) {
      setError(e?.response?.data?.error ?? e?.message ?? "创建失败");
    }
  };

  const doUpload = async (file: File) => {
    const id = newTaskId();
    const knownTotal = file.size > 0 ? file.size : null;
    setTransferTasks((prev) => [
      ...prev,
      {
        id,
        kind: "upload",
        label: file.name,
        status: "running",
        percent: knownTotal ? 0 : null,
        loaded: 0,
        total: knownTotal,
      },
    ]);
    try {
      const dst = joinPath(currentPath, file.name);
      await uploadContainerFile(clusterId, namespace, pod, container, dst, file, {
        onUploadProgress: ({ loaded, total }) => {
          const effTotal = total != null && total > 0 ? total : knownTotal;
          const pct =
            effTotal != null && effTotal > 0
              ? Math.min(100, Math.round((loaded / effTotal) * 100))
              : null;
          setTransferTasks((prev) =>
            prev.map((x) =>
              x.id === id ? { ...x, loaded, total: effTotal, percent: pct } : x,
            ),
          );
        },
      });
      setTransferTasks((prev) =>
        prev.map((x) =>
          x.id === id
            ? {
                ...x,
                status: "success",
                percent: x.percent != null ? 100 : null,
                loaded: file.size,
                total: file.size > 0 ? file.size : x.loaded,
              }
            : x,
        ),
      );
      onToast?.("上传成功");
      refresh();
      scheduleRemoveTransferTask(id);
    } catch (e: any) {
      const msg = e?.response?.data?.error ?? e?.message ?? "上传失败";
      setTransferTasks((prev) =>
        prev.map((x) => (x.id === id ? { ...x, status: "error", percent: null, detail: msg } : x)),
      );
      scheduleRemoveTransferTask(id);
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>
      <div style={{ padding: "10px 12px", borderBottom: "1px solid #0b1220" }}>
        <div
          role="group"
          aria-label="路径地址栏"
          onDoubleClick={(e) => {
            if ((e.target as HTMLElement).closest("button[data-crumb]")) return;
            enterAddressEditMode();
          }}
          style={{
            ...addressBarShellStyle,
            cursor: addressBarMode === "breadcrumb" ? "default" : "text",
          }}
        >
          <span style={addressBarIconStyle} aria-hidden>
            📁
          </span>
          {addressBarMode === "breadcrumb" ? (
            <div
              style={{
                flex: 1,
                minWidth: 0,
                display: "flex",
                alignItems: "center",
                overflowX: "auto",
                padding: "4px 8px 4px 0",
                gap: 2,
              }}
            >
              {breadcrumbs.map((b, idx) => (
                <React.Fragment key={b.path}>
                  <button
                    type="button"
                    data-crumb
                    onClick={() => setCurrentPath(b.path)}
                    style={crumbBtnStyle}
                    title={b.path}
                  >
                    {b.name}
                  </button>
                  {idx < breadcrumbs.length - 1 && (
                    <span style={crumbSepStyle} aria-hidden>
                      ›
                    </span>
                  )}
                </React.Fragment>
              ))}
              <div
                role="presentation"
                tabIndex={-1}
                onClick={enterAddressEditMode}
                style={{
                  flex: 1,
                  minWidth: 12,
                  alignSelf: "stretch",
                  cursor: "text",
                }}
                title="点击输入完整路径"
              />
            </div>
          ) : (
            <input
              ref={addressInputRef}
              value={pathInput}
              onChange={(e) => setPathInput(e.target.value)}
              onBlur={onAddressBarBlur}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  commitPathFromAddressInput();
                } else if (e.key === "Escape") {
                  e.preventDefault();
                  skipAddressBlurRef.current = true;
                  cancelAddressEdit();
                  queueMicrotask(() => {
                    skipAddressBlurRef.current = false;
                  });
                }
              }}
              placeholder="/app/logs"
              spellCheck={false}
              autoComplete="off"
              style={addressInputStyle}
            />
          )}
        </div>
      </div>

      <div
        style={{
          padding: "6px 8px",
          display: "flex",
          flexWrap: "nowrap",
          gap: 4,
          overflowX: "auto",
          borderBottom: "1px solid #0b1220",
        }}
      >
        <button
          type="button"
          onClick={() => {
            const up = parentPath(currentPath);
            setCurrentPath(up);
          }}
          style={toolBtnStyle(false)}
        >
          ↑ 上一级
        </button>
        <button type="button" onClick={refresh} style={toolBtnStyle(false)}>
          刷新
        </button>
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          style={toolBtnStyle(false)}
        >
          上传
        </button>
        <button
          type="button"
          onClick={doDownload}
          style={toolBtnStyle(selectedPaths.length === 0)}
          disabled={selectedPaths.length === 0}
        >
          下载
        </button>
        <button
          type="button"
          onClick={doDelete}
          style={toolBtnStyle(selectedPaths.length === 0)}
          disabled={selectedPaths.length === 0}
        >
          删除
        </button>
        <button type="button" onClick={doRename} style={toolBtnStyle(!canRename)} disabled={!canRename}>
          重命名
        </button>
        <button type="button" onClick={doMkdir} style={toolBtnStyle(false)}>
          新建文件夹
        </button>
        <input
          ref={fileInputRef}
          type="file"
          multiple
          style={{ display: "none" }}
          onChange={(e) => {
            const list = e.target.files;
            if (list?.length) Array.from(list).forEach((f) => void doUpload(f));
            e.currentTarget.value = "";
          }}
        />
      </div>

      <FileTransferTasksPanel tasks={transferTasks} onDismissTask={removeTransferTask} />

      {error && (
        <div style={{ padding: "8px 12px", color: "#f87171", fontSize: 12, borderBottom: "1px solid #0b1220" }}>
          {error}
        </div>
      )}

      <div style={{ flex: 1, minHeight: 0, overflow: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
          <thead>
            <tr>
              <th style={th}><input type="checkbox" onChange={(e) => toggleAll(e.target.checked)} checked={items.length > 0 && items.every((it) => selected[it.name])} /></th>
              <th style={th}>名称</th>
              <th style={th}>类型</th>
              <th style={th}>大小</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td colSpan={4} style={{ ...td, textAlign: "center", color: "#94a3b8" }}>
                  加载中…
                </td>
              </tr>
            )}
            {!loading && items.length === 0 && (
              <tr>
                <td colSpan={4} style={{ ...td, textAlign: "center", color: "#94a3b8" }}>
                  空目录
                </td>
              </tr>
            )}
            {!loading &&
              items.map((it) => (
                <tr key={it.name} style={{ borderBottom: "1px solid #0b1220" }}>
                  <td style={td}>
                    <input
                      type="checkbox"
                      checked={!!selected[it.name]}
                      onChange={(e) => setSelected((prev) => ({ ...prev, [it.name]: e.target.checked }))}
                    />
                  </td>
                  <td
                    style={{ ...td, cursor: it.type === "dir" ? "pointer" : "default", color: "#e2e8f0" }}
                    onClick={() => {
                      if (it.type !== "dir") return;
                      setCurrentPath(joinPath(currentPath, it.name));
                    }}
                    title={it.type === "dir" ? "点击进入目录" : it.name}
                  >
                    <span style={{ marginRight: 6, color: it.type === "dir" ? "#38bdf8" : "#94a3b8" }}>
                      {it.type === "dir" ? "📁" : "📄"}
                    </span>
                    {it.name}
                  </td>
                  <td style={{ ...td, color: "#94a3b8" }}>{it.type === "dir" ? "dir" : "file"}</td>
                  <td style={{ ...td, color: "#94a3b8" }}>{it.type === "dir" ? "-" : sizeText(it.size)}</td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

const addressBarShellStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "stretch",
  minHeight: 34,
  borderRadius: 6,
  border: "1px solid #334155",
  backgroundColor: "#0f172a",
  overflow: "hidden",
};

const addressBarIconStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  paddingLeft: 10,
  paddingRight: 2,
  color: "#64748b",
  fontSize: 14,
  flexShrink: 0,
  userSelect: "none",
};

const crumbBtnStyle: React.CSSProperties = {
  border: "none",
  background: "transparent",
  color: "#38bdf8",
  cursor: "pointer",
  fontSize: 12,
  padding: "4px 6px",
  borderRadius: 4,
  fontWeight: 500,
  whiteSpace: "nowrap",
  flexShrink: 0,
};

const crumbSepStyle: React.CSSProperties = {
  color: "#475569",
  fontSize: 13,
  fontWeight: 600,
  userSelect: "none",
  flexShrink: 0,
  padding: "0 1px",
};

const addressInputStyle: React.CSSProperties = {
  flex: 1,
  minWidth: 0,
  border: "none",
  outline: "none",
  backgroundColor: "#020617",
  color: "#e5e7eb",
  fontSize: 12,
  padding: "6px 10px",
  fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
};

const toolBtn: React.CSSProperties = {
  padding: "3px 7px",
  borderRadius: 6,
  border: "1px solid #334155",
  backgroundColor: "#1e293b",
  color: "#e5e7eb",
  cursor: "pointer",
  fontSize: 11,
  whiteSpace: "nowrap",
  flexShrink: 0,
};

const toolBtnStyle = (disabled: boolean): React.CSSProperties => ({
  ...toolBtn,
  cursor: disabled ? "not-allowed" : "pointer",
  opacity: disabled ? 0.45 : 1,
  backgroundColor: disabled ? "#0b1220" : toolBtn.backgroundColor,
  color: disabled ? "#64748b" : toolBtn.color,
});

const th: React.CSSProperties = {
  textAlign: "left",
  padding: "8px 10px",
  borderBottom: "1px solid #1e293b",
  color: "#94a3b8",
  position: "sticky",
  top: 0,
  backgroundColor: "#020617",
  zIndex: 1,
};

const td: React.CSSProperties = {
  padding: "8px 10px",
};

