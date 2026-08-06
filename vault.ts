// Reads a folder of markdown into a graph: one node per note, one link per
// [[wikilink]] or relative markdown link between two notes.

import { basename, dirname, join, relative, resolve } from "node:path";

export type Options = {
  groupBy: string;      // a frontmatter field name, or the literal "folder"
  exclude: string[];    // globs, matched against the vault-relative path
  unresolved: boolean;  // keep links that point at a note that does not exist
};

export type Node = {
  name: string;
  desc: string;
  group: string;
  out: number[];
  in: number[];
  deg: number;
  mt: number;         // file mtime in ms, for the time-ordered reveal
  ghost?: true;
};

export type Graph = {
  nodes: Node[];
  links: { s: number; t: number }[];
  groups: string[];
  fields: string[];   // frontmatter fields actually seen, for the missing-field warning
  dir: string;
  generated: string;
};

const WIKILINK = /\[\[([^\]|#]+)/g;
const MDLINK = /\]\(([^)\s]+\.md)(?:[^)]*)\)/g;

/** Frontmatter is read as flat `key: value` lines. Nesting is ignored on purpose:
 *  it means `metadata:` followed by an indented `type: project` still yields
 *  `type`, which is what a human means when they say "group by type". */
export function parseFrontmatter(text: string): { fields: Record<string, string>; body: string } {
  const fields: Record<string, string> = {};
  if (!text.startsWith("---")) return { fields, body: text };
  const end = text.indexOf("\n---", 3);
  if (end === -1) return { fields, body: text };
  for (const line of text.slice(3, end).split("\n")) {
    const colon = line.indexOf(":");
    if (colon === -1) continue;
    const key = line.slice(0, colon).trim();
    const value = line.slice(colon + 1).trim().replace(/^["']|["']$/g, "");
    if (key && value) fields[key] = value;
  }
  return { fields, body: text.slice(end + 4) };
}

/** Glob for the exclude list. `*` matches inside one path segment, `**` crosses
 *  separators, and `**` followed by a slash also matches zero folders, so a
 *  pattern like `**` + `/*.md` catches a note at the top level too. Every other
 *  character is literal. */
export function matchGlob(pattern: string, path: string): boolean {
  let rx = "";
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i];
    if (c === "*" && pattern[i + 1] === "*") {
      i++;
      if (pattern[i + 1] === "/") {
        i++;
        rx += "(?:.*/)?";
      } else {
        rx += ".*";
      }
    } else if (c === "*") {
      rx += "[^/]*";
    } else {
      rx += /[.+^${}()|[\]\\?]/.test(c) ? "\\" + c : c;
    }
  }
  return new RegExp("^" + rx + "$").test(path);
}

/** Folders that are never notes, however the vault is laid out: dependency trees,
 *  and anything hidden, which covers .git, .obsidian and Obsidian's .trash. */
function skipped(rel: string): boolean {
  return rel.split("/").slice(0, -1).some((seg) => seg === "node_modules" || seg.startsWith("."));
}

export async function scan(dir: string, opts: Options): Promise<Graph> {
  const root = resolve(dir);
  const paths: string[] = [];
  for await (const rel of new Bun.Glob("**/*.md").scan({ cwd: root, dot: true })) {
    if (skipped(rel)) continue;
    if (opts.exclude.some((p) => matchGlob(p, rel))) continue;
    paths.push(rel);
  }
  paths.sort();

  // A note is addressable by its basename and by its path without the extension,
  // because both forms show up in real vaults.
  const byKey = new Map<string, number>();
  const notes: { rel: string; name: string; desc: string; group: string; mt: number; targets: string[] }[] = [];
  const fields = new Set<string>();

  for (const rel of paths) {
    const file = Bun.file(join(root, rel));
    const text = await file.text();
    const { fields: fm, body } = parseFrontmatter(text);
    for (const k of Object.keys(fm)) fields.add(k);

    const stem = rel.replace(/\.md$/, "");
    const short = basename(stem);
    const targets: string[] = [];
    for (const m of body.matchAll(WIKILINK)) targets.push(m[1].trim());
    for (const m of body.matchAll(MDLINK)) {
      const p = decodeURIComponent(m[1]);
      if (/^[a-z]+:\/\//i.test(p)) continue;               // external URL
      targets.push(relative(root, resolve(root, dirname(rel), p)).replace(/\.md$/, ""));
    }

    const i = notes.length;
    if (!byKey.has(short)) byKey.set(short, i);
    byKey.set(stem, i);
    notes.push({
      rel,
      name: fm.name || short,
      desc: fm.description || "",
      group: opts.groupBy === "folder"
        ? (stem.includes("/") ? stem.split("/")[0] : "root")
        : (fm[opts.groupBy] || ""),
      mt: file.lastModified,
      targets,
    });
  }

  const nodes: Node[] = notes.map((n) => ({
    name: n.name, desc: n.desc, group: n.group, mt: n.mt, out: [], in: [], deg: 0,
  }));

  // Ghost nodes are created lazily, and only when asked for, so an unresolved
  // link never silently invents a node.
  const ghosts = new Map<string, number>();
  const ghostIndex = (key: string) => {
    let i = ghosts.get(key);
    if (i === undefined) {
      i = nodes.length;
      ghosts.set(key, i);
      nodes.push({ name: basename(key), desc: "", group: "", mt: 0, out: [], in: [], deg: 0, ghost: true });
    }
    return i;
  };

  const seen = new Set<string>();
  const links: { s: number; t: number }[] = [];
  notes.forEach((note, s) => {
    for (const target of note.targets) {
      let t = byKey.get(target) ?? byKey.get(basename(target));
      if (t === undefined) {
        if (!opts.unresolved) continue;
        t = ghostIndex(target);
      }
      if (t === s) continue;
      if (!nodes[s].out.includes(t)) nodes[s].out.push(t);
      if (!nodes[t].in.includes(s)) nodes[t].in.push(s);
      const key = s < t ? `${s}-${t}` : `${t}-${s}`;
      if (seen.has(key)) continue;
      seen.add(key);
      links.push({ s, t });
      nodes[s].deg++;
      nodes[t].deg++;
    }
  });

  // A note that does not exist yet has no file to read a time off. Put it after
  // every real note, so the time-ordered reveal shows it arriving behind whatever
  // linked to it rather than ahead of the whole vault.
  if (ghosts.size) {
    const last = Math.max(0, ...notes.map((n) => n.mt));
    for (const i of ghosts.values()) nodes[i].mt = last + 1;
  }

  // Stable group order: most common first, so the legend and the colour cycle
  // both put the dominant kind of note at the top.
  const counts = new Map<string, number>();
  for (const n of nodes) if (n.group) counts.set(n.group, (counts.get(n.group) || 0) + 1);
  const groups = [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map((e) => e[0]);

  return {
    nodes,
    links,
    groups,
    fields: [...fields].sort(),
    dir: root,
    generated: new Date().toISOString().slice(0, 10),
  };
}
