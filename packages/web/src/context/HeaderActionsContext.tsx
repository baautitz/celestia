import React, { createContext, useContext, useState, useEffect } from "react";

interface HeaderActionsContextType {
  actions: React.ReactNode | null;
  setActions: (actions: React.ReactNode | null) => void;
}

const HeaderActionsContext = createContext<HeaderActionsContextType | undefined>(undefined);

export const HeaderActionsProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [actions, setActions] = useState<React.ReactNode | null>(null);

  return (
    <HeaderActionsContext.Provider value={{ actions, setActions }}>
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
