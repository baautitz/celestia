import { matchPath } from "react-router-dom";

/** A rota atual é a da entrada ou uma subrota dela (`/iam/users/1`), nunca só um prefixo de texto (`/iam/users-x`). */
export const isEntryActive = (pathname: string, entryPath: string): boolean =>
  matchPath({ path: entryPath, end: false }, pathname) !== null;
