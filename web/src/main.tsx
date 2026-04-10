import "./monaco/monacoInit";
import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./pages/App";
import { ThemeProvider } from "./theme/ThemeContext";
import "./theme/tokens.css";
import "./global.css";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <ThemeProvider>
      <App />
    </ThemeProvider>
  </React.StrictMode>,
);

