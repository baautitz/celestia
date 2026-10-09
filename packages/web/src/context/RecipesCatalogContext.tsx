import React, { createContext, useCallback, useContext, useEffect, useState } from "react";
import { useLocation } from "react-router-dom";
import type { RecipeSummary } from "@platform/shared";
import { useAuth } from "@/context/AuthContext";
import { api } from "@/lib/api-client";

interface RecipesCatalogContextType {
  recipes: RecipeSummary[];
  loading: boolean;
  /** Rebusca o catálogo (usado após criar, editar, excluir ou recarregar Modelos). */
  refresh: () => void;
}

const RecipesCatalogContext = createContext<RecipesCatalogContextType | undefined>(undefined);

export const RecipesCatalogProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user } = useAuth();
  const location = useLocation();
  const [recipes, setRecipes] = useState<RecipeSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [version, setVersion] = useState(0);

  const refresh = useCallback(() => setVersion((v) => v + 1), []);

  // Rebusca ao logar, a cada troca de página e quando alguém pede refresh.
  useEffect(() => {
    if (!user) return;
    api.recipes
      .list()
      .then(setRecipes)
      .catch(() => setRecipes([]))
      .finally(() => setLoading(false));
  }, [user, location.pathname, version]);

  return (
    <RecipesCatalogContext.Provider value={{ recipes, loading, refresh }}>
      {children}
    </RecipesCatalogContext.Provider>
  );
};

export const useRecipesCatalog = (): RecipesCatalogContextType => {
  const context = useContext(RecipesCatalogContext);
  if (!context) {
    throw new Error("useRecipesCatalog must be used within RecipesCatalogProvider");
  }
  return context;
};
