import React from "react";
import { z } from "zod";
import ReactDOM from "react-dom/client";
import { createBrowserRouter, RouterProvider } from "react-router-dom";
import { AuthProvider } from "./context/AuthContext";
import { HeaderActionsProvider } from "./context/HeaderActionsContext";
import { UiProvider } from "@platform/ui/imperative/provider";
import { useRouterNavigation } from "@platform/ui/adapters/navigation-router";
import { setApiFetch } from "@platform/ui/lib/api";
import { api } from "./lib/api-client";
import { App } from "./App";
import { webServices } from "./modules";
import { WebServicesProvider } from "@platform/ui/contracts/web-services";
import "./index.css";

// Mensagens de validação do zod em português (as de cada campo, quando existem, têm precedência).
z.config(z.locales.ptBR());

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
        <WebServicesProvider services={webServices}>
          <AuthProvider>
            <RouterUiProvider>
              <HeaderActionsProvider>
                <App />
              </HeaderActionsProvider>
            </RouterUiProvider>
          </AuthProvider>
        </WebServicesProvider>
      ),
    },
  ],
);

const rootElement = document.getElementById("root");
if (!rootElement) throw new Error("Elemento #root não encontrado no index.html.");

ReactDOM.createRoot(rootElement).render(
  <React.StrictMode>
    <RouterProvider router={router} />
  </React.StrictMode>
);
