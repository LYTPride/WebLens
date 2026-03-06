import React, { useEffect, useRef, useState } from "react";

interface PodShellProps {
  wsUrl: string;
  podName: string;
  namespace: string;
  onClose: () => void;
}

export const PodShell: React.FC<PodShellProps> = ({ wsUrl, podName, namespace, onClose }) => {
  const [output, setOutput] = useState<string>("");
  const [input, setInput] = useState("");
  const [connected, setConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const preRef = useRef<HTMLPreElement>(null);

  useEffect(() => {
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;
    ws.binaryType = "arraybuffer";

    ws.onopen = () => setConnected(true);
    ws.onclose = () => {
      setConnected(false);
      setOutput((prev) => prev + "\r\n[连接已关闭]");
    };
    ws.onerror = () => setOutput((prev) => prev + "\r\n[连接错误]");
    ws.onmessage = (ev) => {
      const data = ev.data;
      if (data instanceof ArrayBuffer) {
        const decoder = new TextDecoder();
        setOutput((prev) => prev + decoder.decode(data));
      } else if (typeof data === "string") {
        setOutput((prev) => prev + data);
      }
    };

    return () => {
      ws.close();
      wsRef.current = null;
    };
  }, [wsUrl]);

  useEffect(() => {
    if (preRef.current) preRef.current.scrollTop = preRef.current.scrollHeight;
  }, [output]);

  const send = () => {
    if (!input.trim() || !wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
    const toSend = input + "\r\n";
    wsRef.current.send(toSend);
    setInput("");
  };

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

  const boxStyle: React.CSSProperties = {
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

  const preStyle: React.CSSProperties = {
    flex: 1,
    margin: 0,
    padding: 12,
    overflow: "auto",
    fontSize: 13,
    fontFamily: "monospace",
    color: "#e2e8f0",
    backgroundColor: "#020617",
    whiteSpace: "pre-wrap",
    wordBreak: "break-all",
  };

  const inputRowStyle: React.CSSProperties = {
    padding: 8,
    borderTop: "1px solid #1e293b",
    display: "flex",
    gap: 8,
  };

  return (
    <div style={panelStyle} onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div style={boxStyle} onClick={(e) => e.stopPropagation()}>
        <div style={headerStyle}>
          <span>
            Shell: {namespace}/{podName} {connected ? "· 已连接" : "· 连接中…"}
          </span>
          <button
            type="button"
            onClick={onClose}
            style={{
              padding: "4px 10px",
              borderRadius: 4,
              border: "1px solid #1e293b",
              backgroundColor: "#1e293b",
              color: "#e2e8f0",
              cursor: "pointer",
            }}
          >
            关闭
          </button>
        </div>
        <pre ref={preRef} style={preStyle}>
          {output || "(等待输出…)"}
        </pre>
        <div style={inputRowStyle}>
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && send()}
            placeholder={connected ? "输入命令回车执行" : "连接中…"}
            disabled={!connected}
            style={{
              flex: 1,
              padding: "8px 10px",
              borderRadius: 4,
              border: "1px solid #1e293b",
              backgroundColor: "#020617",
              color: "#e2e8f0",
              fontFamily: "monospace",
              fontSize: 13,
            }}
          />
          <button
            type="button"
            onClick={send}
            disabled={!connected}
            style={{
              padding: "8px 14px",
              borderRadius: 4,
              border: "1px solid #1e293b",
              backgroundColor: "#0f172a",
              color: "#e2e8f0",
              cursor: connected ? "pointer" : "not-allowed",
            }}
          >
            发送
          </button>
        </div>
      </div>
    </div>
  );
};
