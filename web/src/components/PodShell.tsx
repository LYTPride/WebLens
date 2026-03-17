import React, { useEffect, useRef, useState } from "react";
import { Terminal } from "xterm";
import { FitAddon } from "@xterm/addon-fit";
import "xterm/css/xterm.css";

interface PodShellProps {
  wsUrl: string;
  podName: string;
  namespace: string;
  onClose: () => void;
  /** 内嵌模式：不占满屏，无遮罩，适合放在底部面板中 */
  inline?: boolean;
}

export const PodShell: React.FC<PodShellProps> = ({ wsUrl, podName, namespace, onClose, inline }) => {
  const [connected, setConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; visible: boolean }>({
    x: 0,
    y: 0,
    visible: false,
  });
  const [hoverMenuItem, setHoverMenuItem] = useState<"copy" | "paste" | null>(null);

  // 初始化 xterm 终端
  useEffect(() => {
    const term = new Terminal({
      fontFamily:
        "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace",
      fontSize: 14,
      theme: {
        background: "#020617",
        foreground: "#e2e8f0",
      },
      cursorBlink: true,
      scrollback: 2000,
    });
    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    fitAddonRef.current = fitAddon;
    termRef.current = term;
    if (containerRef.current) {
      term.open(containerRef.current);
      fitAddon.fit();
      term.focus();
    }

    return () => {
      fitAddonRef.current = null;
      term.dispose();
      termRef.current = null;
    };
  }, []);

  // 当容器尺寸变化（包括拖动底部面板高度、浏览器窗口变化）时，自动让终端充满整个黑色区域
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const fit = fitAddonRef.current;
    if (fit) {
      fit.fit();
    }
    const ro = new ResizeObserver(() => {
      const f = fitAddonRef.current;
      if (f) f.fit();
    });
    ro.observe(el);
    return () => {
      ro.disconnect();
    };
  }, []);

  // 建立 WebSocket 与容器内 /bin/sh 的双向连接
  useEffect(() => {
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;
    ws.binaryType = "arraybuffer";

    ws.onopen = () => setConnected(true);
    ws.onclose = () => {
      setConnected(false);
      termRef.current?.writeln("\r\n[连接已关闭]");
    };
    ws.onerror = () => {
      termRef.current?.writeln("\r\n[连接错误]");
    };
    ws.onmessage = (ev) => {
      const data = ev.data;
      let text: string;
      if (data instanceof ArrayBuffer) {
        text = new TextDecoder().decode(data);
      } else if (typeof data === "string") {
        text = data;
      } else {
        return;
      }
      termRef.current?.write(text);
    };

    return () => {
      ws.close();
      wsRef.current = null;
    };
  }, [wsUrl]);

  // 将用户在终端中的键盘输入直接转发到 WebSocket，支持 Tab 补全、方向键历史等
  useEffect(() => {
    const term = termRef.current;
    if (!term) return;

    const disposable = term.onData((data) => {
      if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
      wsRef.current.send(data);
    });

    // 自定义按键处理：拦截 Ctrl+V，改为触发浏览器原生粘贴
    const keyHandler = (ev: KeyboardEvent): boolean => {
      if ((ev.ctrlKey || ev.metaKey) && (ev.key === "v" || ev.key === "V")) {
        // 让浏览器处理 Ctrl+V 粘贴，避免发送 ^V 到容器
        return false;
      }
      return true;
    };
    term.attachCustomKeyEventHandler(keyHandler);

    return () => {
      disposable.dispose();
    };
  }, []);

  const panelStyle: React.CSSProperties = {
    position: "fixed",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: "rgba(0,0,0,0.7)",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 1000,
  };

  const boxStyle: React.CSSProperties = inline
    ? {
        flex: 1,
        minHeight: 0,
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        backgroundColor: "#020617",
      }
    : {
        width: "90%",
        maxWidth: 900,
        height: "70%",
        backgroundColor: "#0f172a",
        border: "1px solid #1e293b",
        borderRadius: 8,
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
      };

  const headerStyle: React.CSSProperties = {
    padding: "10px 14px",
    borderBottom: "1px solid #1e293b",
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    fontSize: 14,
  };

  const terminalStyle: React.CSSProperties = {
    flex: 1,
    minHeight: 0,
    margin: 0,
    padding: 0,
    backgroundColor: "#020617",
    display: "flex",
  };

  const handleContextMenu: React.MouseEventHandler<HTMLDivElement> = (e) => {
    e.preventDefault();
    const menuWidth = 160;
    const menuHeight = 80;
    let x = e.clientX;
    let y = e.clientY;
    const vw = window.innerWidth || document.documentElement.clientWidth;
    const vh = window.innerHeight || document.documentElement.clientHeight;
    if (x + menuWidth > vw) x = Math.max(0, vw - menuWidth - 4);
    if (y + menuHeight > vh) y = Math.max(0, vh - menuHeight - 4);
    setContextMenu({
      x,
      y,
      visible: true,
    });
  };

  const hideContextMenu = () => {
    setContextMenu((prev) => (prev.visible ? { ...prev, visible: false } : prev));
  };

  const handleCopySelection = async () => {
    const term = termRef.current;
    if (!term) return;
    const text = term.getSelection();
    if (!text) {
      hideContextMenu();
      return;
    }
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        const textarea = document.createElement("textarea");
        textarea.value = text;
        textarea.style.position = "fixed";
        textarea.style.opacity = "0";
        textarea.style.left = "-9999px";
        document.body.appendChild(textarea);
        textarea.focus();
        textarea.select();
        document.execCommand && document.execCommand("copy");
        document.body.removeChild(textarea);
      }
    } finally {
      hideContextMenu();
    }
  };

  const handlePasteFromClipboard = async () => {
    try {
      let text = "";
      if (navigator.clipboard && navigator.clipboard.readText) {
        text = await navigator.clipboard.readText();
      }
      if (!text) {
        termRef.current?.writeln("\r\n[粘贴失败：剪贴板为空或浏览器未允许访问，请使用 Ctrl+V 粘贴]");
        hideContextMenu();
        return;
      }
      // 去掉复制时可能带上的换行/空白，避免将独立的换行当作多条命令执行
      text = text.replace(/\r?\n/g, " ").trim();
      if (!text) {
        hideContextMenu();
        return;
      }
      const term = termRef.current;
      if (term) {
        term.focus();
        // 使用 xterm 的 paste：本地立即回显，并通过 onData 管道转发到 WebSocket
        term.paste(text);
      }
    } catch {
      termRef.current?.writeln("\r\n[粘贴失败：浏览器拒绝访问剪贴板，请使用 Ctrl+V 粘贴]");
    } finally {
      hideContextMenu();
    }
  };

  const inner = (
    <div style={boxStyle} onClick={(e) => e.stopPropagation()}>
      <div style={headerStyle}>
        <span>
          Shell: {namespace}/{podName} {connected ? "· 已连接" : "· 连接中…"}
        </span>
      </div>
      <div
        style={terminalStyle}
        onClick={() => termRef.current?.focus()}
        onContextMenu={handleContextMenu}
      >
        <div
          ref={containerRef}
          style={{ flex: 1, minHeight: 0, width: "100%", height: "100%" }}
        />
      </div>
      {contextMenu.visible && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 1100,
          }}
          onClick={hideContextMenu}
        >
          <div
            style={{
              position: "fixed",
              top: contextMenu.y,
              left: contextMenu.x,
              backgroundColor: "#020617",
              border: "1px solid #1e293b",
              borderRadius: 6,
              boxShadow: "0 8px 20px rgba(0,0,0,0.6)",
              padding: 4,
              minWidth: 120,
              zIndex: 1101,
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              onClick={handleCopySelection}
              onMouseEnter={() => setHoverMenuItem("copy")}
              onMouseLeave={() => setHoverMenuItem((v) => (v === "copy" ? null : v))}
              style={{
                display: "block",
                width: "100%",
                padding: "6px 10px",
                border: "none",
                background: hoverMenuItem === "copy" ? "#1e293b" : "transparent",
                color: "#e5e7eb",
                fontSize: 13,
                textAlign: "left",
                cursor: "pointer",
              }}
            >
              复制
            </button>
            <button
              type="button"
              onClick={handlePasteFromClipboard}
              onMouseEnter={() => setHoverMenuItem("paste")}
              onMouseLeave={() => setHoverMenuItem((v) => (v === "paste" ? null : v))}
              style={{
                display: "block",
                width: "100%",
                padding: "6px 10px",
                border: "none",
                background: hoverMenuItem === "paste" ? "#1e293b" : "transparent",
                color: "#e5e7eb",
                fontSize: 13,
                textAlign: "left",
                cursor: "pointer",
              }}
            >
              粘贴
            </button>
          </div>
        </div>
      )}
    </div>
  );

  if (inline) return inner;
  return (
    <div style={panelStyle} onClick={(e) => e.target === e.currentTarget && onClose()}>
      {inner}
    </div>
  );
};
