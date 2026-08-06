// Themes are TOML files in ~/.config/nous/themes/<name>.toml. A theme carries the
// palette, the group colours, and the look knobs that are taste rather than data.

import { join } from "node:path";
import { THEMES_DIR } from "./paths.ts";

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

export const BUILTIN = "spider-verse";

const DEFAULTS: Theme = {
  meta: { name: "Spider-Verse", variant: "dark" },
  colors: {
    bg: "#0d0a1e", panel: "#1b1638", text: "#ece9f7",
    muted: "#5c5480", accent: "#ff1f6b", link: "#5c5480",
  },
  groups: {
    project: "#00d4ff", feedback: "#ff1f6b",
    reference: "#3dffa8", user: "#ffc93c",
  },
  cycle: ["#00d4ff", "#ff1f6b", "#3dffa8", "#ffc93c", "#8b6cff", "#ff473c", "#00a8cc", "#f2a2c8"],
  feel: {
    node_scale: 1, label_size: 11, link_opacity: 0.26,
    glow: true, halftone: true, duotone: ["#ff1f6b", "#00d4ff"],
  },
};

/** The shipped theme, written to disk on first run so there is something to copy. */
export const BUILTIN_TOML = `# nous theme. Copy this file to make your own; the file name is the theme name.
[meta]
name = "Spider-Verse"
variant = "dark"

[colors]
bg     = "#0d0a1e"   # canvas
panel  = "#1b1638"   # detail panel and inputs
text   = "#ece9f7"
muted  = "#5c5480"   # labels, links, secondary type
accent = "#ff1f6b"   # focus highlight
link   = "#5c5480"   # edges

# One colour per value of the config's group_by field. Values not listed here
# take the next unused colour from cycle.
[groups]
project   = "#00d4ff"
feedback  = "#ff1f6b"
reference = "#3dffa8"
user      = "#ffc93c"
cycle     = ["#00d4ff", "#ff1f6b", "#3dffa8", "#ffc93c", "#8b6cff", "#ff473c", "#00a8cc", "#f2a2c8"]

[feel]
node_scale   = 1.0
label_size   = 11
link_opacity = 0.26
glow         = true
halftone     = true               # faint print texture behind the canvas
duotone      = ["#ff1f6b", "#00d4ff"]   # misregistered plates behind each node; false to disable
`;

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
    groups: Object.keys(groups).length ? groups : DEFAULTS.groups,
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

export async function load(name: string): Promise<Theme> {
  const file = Bun.file(join(THEMES_DIR, `${name}.toml`));
  if (await file.exists()) return fromToml(Bun.TOML.parse(await file.text()));
  if (name === BUILTIN) return fromToml(Bun.TOML.parse(BUILTIN_TOML));
  throw new Error(`no theme "${name}" in ${THEMES_DIR} — try: nous themes`);
}

export async function list(): Promise<string[]> {
  const names = new Set<string>([BUILTIN]);
  try {
    for await (const f of new Bun.Glob("*.toml").scan({ cwd: THEMES_DIR })) {
      names.add(f.replace(/\.toml$/, ""));
    }
  } catch {
    // no themes directory yet; the builtin still resolves
  }
  return [...names].sort();
}

/** Assign every group a colour: the theme's explicit mapping first, then the cycle
 *  in order for anything it does not name.
 *
 *  Only colours claimed by a group *present in this graph* are skipped. Reserving
 *  every colour the theme mentions would mean a vault whose groups happen not to
 *  match the theme's names gets whatever is left over, which is how the good
 *  colours end up unused and the graph ends up muddy. */
export function colorMap(theme: Theme, groups: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  const taken = new Set(groups.map((g) => theme.groups[g]).filter(Boolean));
  let next = 0;
  for (const g of groups) {
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
