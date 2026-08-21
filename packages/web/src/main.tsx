import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { AuthProvider } from "./context/AuthContext";
import { ImperativeUIProvider } from "./context/ImperativeUIContext";
import { HeaderActionsProvider } from "./context/HeaderActionsContext";
import { App } from "./App";
import "./index.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <AuthProvider>
        <ImperativeUIProvider>
          <HeaderActionsProvider>
            <App />
          </HeaderActionsProvider>
        </ImperativeUIProvider>
      </AuthProvider>
    </BrowserRouter>
  </React.StrictMode>
);
