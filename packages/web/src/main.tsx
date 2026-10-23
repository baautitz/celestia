import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { AuthProvider } from "./context/AuthContext";
import { HeaderActionsProvider } from "./context/HeaderActionsContext";
import { UiProvider } from "@platform/ui/imperative/provider";
import { useRouterNavigation } from "@platform/ui/adapters/navigation-router";
import { setApiFetch } from "@platform/ui/lib/api";
import { api } from "./lib/api-client";
import { App } from "./App";
import "./index.css";

// Conecta o transporte autenticado da plataforma ao helper da UI (usado por Plugins)
setApiFetch((path, options) => api.request(path, options));

function RouterUiProvider({ children }: { children: React.ReactNode }) {
  return <UiProvider navigation={useRouterNavigation()}>{children}</UiProvider>;
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <AuthProvider>
        <RouterUiProvider>
          <HeaderActionsProvider>
            <App />
          </HeaderActionsProvider>
        </RouterUiProvider>
      </AuthProvider>
    </BrowserRouter>
  </React.StrictMode>
);
