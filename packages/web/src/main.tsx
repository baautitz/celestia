import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { AuthProvider } from "./context/AuthContext";
import { ImperativeUIProvider } from "./context/ImperativeUIContext";
import { HeaderActionsProvider } from "./context/HeaderActionsContext";
import { UiProvider } from "@platform/ui/imperative/provider";
import { useRouterNavigation } from "@platform/ui/adapters/navigation-router";
import { App } from "./App";
import "./index.css";

function RouterUiProvider({ children }: { children: React.ReactNode }) {
  return <UiProvider navigation={useRouterNavigation()}>{children}</UiProvider>;
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <AuthProvider>
        <RouterUiProvider>
          <ImperativeUIProvider>
            <HeaderActionsProvider>
              <App />
            </HeaderActionsProvider>
          </ImperativeUIProvider>
        </RouterUiProvider>
      </AuthProvider>
    </BrowserRouter>
  </React.StrictMode>
);
