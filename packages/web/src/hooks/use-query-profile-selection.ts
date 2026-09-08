import { useCallback, useEffect, useMemo, useState } from "react";
import type { ComponentProfileMeta } from "@platform/shared";

const STORAGE_VERSION = "v1";

interface UseQueryProfileSelectionOptions {
  recipeId: string;
  workspaceId: string;
  componentId: string;
  profiles?: ComponentProfileMeta[];
}

function readStoredProfile(storageKey: string): string | undefined {
  if (typeof window === "undefined") return undefined;
  try {
    return window.localStorage.getItem(storageKey) || undefined;
  } catch {
    return undefined;
  }
}

function writeStoredProfile(storageKey: string, profileId: string): void {
  try {
    window.localStorage.setItem(storageKey, profileId);
  } catch {
    // Preferência local é opcional em modo privado ou quando o storage está bloqueado.
  }
}

export function useQueryProfileSelection({
  recipeId,
  workspaceId,
  componentId,
  profiles = [],
}: UseQueryProfileSelectionOptions): [string | undefined, (profileId: string) => void] {
  const storageKey = useMemo(
    () =>
      `celestia:query-profile:${STORAGE_VERSION}:${encodeURIComponent(recipeId)}:${encodeURIComponent(workspaceId)}:${encodeURIComponent(componentId)}`,
    [recipeId, workspaceId, componentId]
  );
  const [profileId, setProfileId] = useState<string | undefined>(() =>
    readStoredProfile(storageKey)
  );

  useEffect(() => {
    const storedProfileId = readStoredProfile(storageKey);
    setProfileId((currentProfileId) => {
      if (storedProfileId && profiles.some((profile) => profile.id === storedProfileId)) {
        return storedProfileId;
      }
      if (currentProfileId && profiles.some((profile) => profile.id === currentProfileId)) {
        return currentProfileId;
      }
      return profiles[0]?.id;
    });
  }, [storageKey, profiles]);

  const selectProfile = useCallback(
    (nextProfileId: string) => {
      setProfileId(nextProfileId);
      writeStoredProfile(storageKey, nextProfileId);
    },
    [storageKey]
  );

  return [profileId, selectProfile];
}
