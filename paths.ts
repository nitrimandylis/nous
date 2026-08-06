import { homedir } from "node:os";
import { join } from "node:path";

export const CONFIG_DIR = process.env.NOUS_CONFIG || join(homedir(), ".config", "nous");
export const CONFIG_FILE = join(CONFIG_DIR, "config.toml");
export const THEMES_DIR = join(CONFIG_DIR, "themes");

export function expand(path: string): string {
  if (path === "~") return homedir();
  if (path.startsWith("~/")) return join(homedir(), path.slice(2));
  return path;
}
