// Themes are TOML files in ~/.config/nous/themes/<name>.toml. A theme carries the
// palette, the group colours, and the look knobs that are taste rather than data.

import { join } from "node:path";
import { THEMES_DIR } from "./paths.ts";
import { BUILTINS, DEFAULT_THEME } from "./builtin.ts";

export type Theme = {
  meta: { name: string; variant: string };
  colors: { bg: string; panel: string; text: string; muted: string; accent: string; link: string };
  groups: Record<string, string>;
  cycle: string[];
  feel: {
    node_scale: number;
    label_size: number;
    link_opacity: number;
    glow: boolean;
    halftone: boolean;
    duotone: [string, string] | false;
  };
};

export const BUILTIN = DEFAULT_THEME;

/** What a theme file gets when it leaves a field out. Deliberately plain: a theme
 *  that names no groups has none, rather than inheriting somebody else's. */
const DEFAULTS: Theme = {
  meta: { name: "nous", variant: "dark" },
  colors: {
    bg: "#0d0a1e", panel: "#1b1638", text: "#ece9f7",
    muted: "#8d86ac", accent: "#ff1f6b", link: "#5c5480",
  },
  groups: {},
  cycle: ["#00d4ff", "#ff1f6b", "#3dffa8", "#ffc93c", "#8b6cff", "#ff473c", "#00a8cc", "#d6155a"],
  feel: {
    node_scale: 1, label_size: 11, link_opacity: 0.26,
    glow: true, halftone: false, duotone: false,
  },
};

function pick<T>(value: unknown, fallback: T): T {
  return value === undefined || value === null ? fallback : (value as T);
}

export function fromToml(raw: any): Theme {
  const groups: Record<string, string> = {};
  let cycle = DEFAULTS.cycle;
  for (const [k, v] of Object.entries(raw?.groups ?? {})) {
    if (k === "cycle") cycle = v as string[];
    else if (typeof v === "string") groups[k] = v;
  }
  const duotone = raw?.feel?.duotone;
  return {
    meta: {
      name: pick(raw?.meta?.name, DEFAULTS.meta.name),
      variant: pick(raw?.meta?.variant, DEFAULTS.meta.variant),
    },
    colors: { ...DEFAULTS.colors, ...(raw?.colors ?? {}) },
    groups,
    cycle,
    feel: {
      node_scale: pick(raw?.feel?.node_scale, DEFAULTS.feel.node_scale),
      label_size: pick(raw?.feel?.label_size, DEFAULTS.feel.label_size),
      link_opacity: pick(raw?.feel?.link_opacity, DEFAULTS.feel.link_opacity),
      glow: pick(raw?.feel?.glow, DEFAULTS.feel.glow),
      halftone: pick(raw?.feel?.halftone, DEFAULTS.feel.halftone),
      duotone: Array.isArray(duotone) ? [duotone[0], duotone[1]] : duotone === false ? false : DEFAULTS.feel.duotone,
    },
  };
}

/** A theme on disk wins over the shipped copy of the same name, so editing one is
 *  never undone by an upgrade. */
export async function load(name: string): Promise<Theme> {
  const file = Bun.file(join(THEMES_DIR, `${name}.toml`));
  if (await file.exists()) return fromToml(Bun.TOML.parse(await file.text()));
  if (BUILTINS[name]) return fromToml(Bun.TOML.parse(BUILTINS[name]!));
  throw new Error(`no theme "${name}" in ${THEMES_DIR} — try: nous themes`);
}

export async function list(): Promise<string[]> {
  const names = new Set<string>(Object.keys(BUILTINS));
  try {
    for await (const f of new Bun.Glob("*.toml").scan({ cwd: THEMES_DIR })) {
      names.add(f.replace(/\.toml$/, ""));
    }
  } catch {
    // no themes directory yet; the shipped ones still resolve
  }
  return [...names].sort();
}

/** Assign every group a colour: the theme's explicit mapping first, then the cycle
 *  in order for anything it does not name.
 *
 *  Only colours claimed by a group *present in this graph* are skipped. Reserving
 *  every colour the theme mentions would mean a vault whose groups happen not to
 *  match the theme's names gets whatever is left over, which is how the good
 *  colours end up unused and the graph ends up muddy.
 *
 *  Assignment walks the groups in alphabetical order, not the order they arrive
 *  in, which is by how common they are. A colour has to follow the name: writing
 *  three more notes should never repaint the groups that were already there. */
export function colorMap(theme: Theme, groups: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  const taken = new Set(groups.map((g) => theme.groups[g]).filter(Boolean));
  let next = 0;
  for (const g of [...groups].sort()) {
    if (theme.groups[g]) {
      out[g] = theme.groups[g];
      continue;
    }
    while (next < theme.cycle.length && taken.has(theme.cycle[next])) next++;
    out[g] = theme.cycle[next] ?? theme.cycle[next % theme.cycle.length] ?? theme.colors.accent;
    taken.add(out[g]);
    next++;
  }
  return out;
}
