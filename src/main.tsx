import { Component, StrictMode, type ErrorInfo, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { Admin } from "./Admin";
import "highlight.js/styles/github.css";
import "./styles.css";

interface AppErrorBoundaryState {
  failed: boolean;
}

class AppErrorBoundary extends Component<{ children: ReactNode }, AppErrorBoundaryState> {
  state: AppErrorBoundaryState = { failed: false };

  static getDerivedStateFromError(): AppErrorBoundaryState {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error("NeuronDeck UI error", error, info);
  }

  render(): ReactNode {
    if (!this.state.failed) return this.props.children;
    const chinese = document.documentElement.lang.startsWith("zh");
    return (
      <main className="app-error" role="alert">
        <div className="app-error-card">
          <span className="eyebrow">NeuronDeck</span>
          <h1>{chinese ? "页面需要重新载入" : "This page needs a refresh"}</h1>
          <p>{chinese
            ? "界面更新时遇到了意外问题。你的对话仍保存在浏览器中。"
            : "The interface hit an unexpected error. Your conversations are still stored in this browser."}</p>
          <button type="button" onClick={() => window.location.reload()}>
            {chinese ? "重新载入" : "Reload"}
          </button>
        </div>
      </main>
    );
  }
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <AppErrorBoundary>
      {/^\/admin\/?$/.test(window.location.pathname) ? <Admin /> : <App />}
    </AppErrorBoundary>
  </StrictMode>,
);
