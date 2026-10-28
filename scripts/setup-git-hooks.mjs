// Points git at the versioned .githooks directory. Silent no-op outside a git checkout (e.g. CI tarballs).
import { existsSync } from "node:fs";
import { execFileSync } from "node:child_process";

if (existsSync(".git")) {
  try {
    execFileSync("git", ["config", "core.hooksPath", ".githooks"], { stdio: "ignore" });
  } catch {
    // git unavailable: skip
  }
}
