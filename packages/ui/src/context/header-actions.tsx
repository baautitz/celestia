import React, { createContext, useContext, useState, useEffect } from "react";

interface HeaderActionsContextType {
  actions: React.ReactNode | null;
  setActions: (actions: React.ReactNode | null) => void;
  /** Destino da seta de voltar exibida ao lado do botão da sidebar. */
  backTo: string | null;
  setBackTo: (to: string | null) => void;
}

const HeaderActionsContext = createContext<HeaderActionsContextType | undefined>(undefined);

export const HeaderActionsProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [actions, setActions] = useState<React.ReactNode | null>(null);
  const [backTo, setBackTo] = useState<string | null>(null);

  return (
    <HeaderActionsContext.Provider value={{ actions, setActions, backTo, setBackTo }}>
      {children}
    </HeaderActionsContext.Provider>
  );
};

export const useHeaderActions = (): HeaderActionsContextType => {
  const context = useContext(HeaderActionsContext);
  if (!context) {
    throw new Error("useHeaderActions must be used within HeaderActionsProvider");
  }
  return context;
};

export const HeaderActions: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { setActions } = useHeaderActions();

  useEffect(() => {
    setActions(children);
    return () => {
      setActions(null);
    };
  }, [children, setActions]);

  return null;
};

/** Registra a seta de voltar do cabeçalho global (ao lado do botão da sidebar) enquanto a página estiver montada. */
export const HeaderBack: React.FC<{ to: string }> = ({ to }) => {
  const { setBackTo } = useHeaderActions();

  useEffect(() => {
    setBackTo(to);
    return () => {
      setBackTo(null);
    };
  }, [to, setBackTo]);

  return null;
};
