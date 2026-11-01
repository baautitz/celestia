import React from "react";
import ReactDOM from "react-dom/client";
import { createBrowserRouter, RouterProvider } from "react-router-dom";
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

// Roteador de dados: é o que permite a uma tela segurar a saída (useLeaveGuard). As rotas seguem em <App />.
const router = createBrowserRouter(
  [
    {
      path: "*",
      element: (
        <AuthProvider>
          <RouterUiProvider>
            <HeaderActionsProvider>
              <App />
            </HeaderActionsProvider>
          </RouterUiProvider>
        </AuthProvider>
      ),
    },
  ],
  { future: { v7_relativeSplatPath: true } },
);

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <RouterProvider router={router} future={{ v7_startTransition: true }} />
  </React.StrictMode>
);
