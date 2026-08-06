#!/usr/bin/env bun
// nous — serve any folder of linked markdown as a force graph.

import { basename, resolve } from "node:path";
import { mkdir } from "node:fs/promises";
import pageAsset from "./page.html" with { type: "text" };
import { scan, type Graph } from "./vault.ts";
import * as themes from "./theme.ts";
import { BUILTINS } from "./builtin.ts";
import { CONFIG_DIR, CONFIG_FILE, THEMES_DIR, expand } from "./paths.ts";

// `with { type: "text" }` makes Bun hand the file over as a string, and bundle it
// into the compiled binary. The ambient *.html type from @types/bun describes the
// bundler import instead, so it needs saying out loud here.
const page = pageAsset as unknown as string;

const VERSION = "0.1.0";

const HELP = `nous — see a folder of linked notes as a graph

usage:
  nous [dir]                serve the vault and open it in a browser
  nous build [file]         write a standalone html file (default graph.html)
  nous themes               list installed themes
  nous config               show the resolved settings and where they came from
  nous -h, --help           this
  nous -v, --version        version

options:
  --port N                  port to serve on (default 4321, climbs if busy)
  --theme NAME              override the configured theme for this run
  --group-by FIELD          frontmatter field to colour by, or "folder"
  --no-open                 do not open a browser
  --json                    machine-readable output (build, themes, config)

config lives in ~/.config/nous/config.toml, themes in ~/.config/nous/themes/.
Both are written on first run.`;

type Config = {
  dir: string;
  group_by: string;
  exclude: string[];
  theme: string;
  port: number;
  unresolved: boolean;
  physics: Record<string, number>;
};

const DEFAULTS: Config = {
  dir: ".",
  group_by: "type",
  exclude: [],
  theme: themes.BUILTIN,
  port: 4321,
  unresolved: false,
  physics: { repel: 5200, link_length: 190, link_strength: 0.0075, center: 0.00035, damping: 0.86 },
};

const SCAFFOLD = `# nous config

# The folder to read. Every .md file under it becomes a node.
dir = "."

# What decides a node's colour: a frontmatter field name, or the literal "folder".
group_by = "type"

# Notes to leave out, as globs against the path inside the vault. An index file
# that links to everything is worth excluding: it renders as one hub with a spoke
# to every note and flattens the rest of the graph.
exclude = []

theme = "spider-verse"
port = 4321

# Draw a placeholder for a [[link]] whose note does not exist yet.
unresolved = false

[physics]
repel        = 5200      # how hard nodes push each other apart
link_length  = 190       # rest length of a link
link_strength = 0.0075   # how strongly a link pulls back to that length
center        = 0.00035  # pull toward the middle
damping       = 0.86
`;

function die(msg: string): never {
  console.error(`nous: ${msg}`);
  process.exit(1);
}

/** Write the config on first run, and top up any shipped theme that is not on
 *  disk. An existing file is never overwritten, so edits survive an upgrade and
 *  a new version's themes still appear. */
async function ensureConfig(): Promise<void> {
  await mkdir(THEMES_DIR, { recursive: true });
  if (!(await Bun.file(CONFIG_FILE).exists())) {
    await Bun.write(CONFIG_FILE, SCAFFOLD);
    console.error(`nous: wrote ${CONFIG_FILE}`);
  }
  const added: string[] = [];
  for (const [name, toml] of Object.entries(BUILTINS)) {
    const path = `${THEMES_DIR}/${name}.toml`;
    if (await Bun.file(path).exists()) continue;
    await Bun.write(path, toml);
    added.push(name);
  }
  if (added.length) console.error(`nous: added ${added.length} themes to ${THEMES_DIR}`);
}

async function loadConfig(): Promise<Config> {
  await ensureConfig();
  let raw: any = {};
  try {
    raw = Bun.TOML.parse(await Bun.file(CONFIG_FILE).text());
  } catch (e) {
    die(`${CONFIG_FILE} is not valid TOML — ${(e as Error).message}`);
  }
  return {
    ...DEFAULTS,
    ...raw,
    physics: { ...DEFAULTS.physics, ...(raw.physics ?? {}) },
  };
}

type Flags = { port?: number; theme?: string; groupBy?: string; open: boolean; json: boolean };

function parseFlags(argv: string[]): { args: string[]; flags: Flags } {
  const args: string[] = [];
  const flags: Flags = { open: true, json: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--port") flags.port = Number(argv[++i]);
    else if (a === "--theme") flags.theme = argv[++i];
    else if (a === "--group-by") flags.groupBy = argv[++i];
    else if (a === "--no-open") flags.open = false;
    else if (a === "--json") flags.json = true;
    else if (a.startsWith("-")) die(`unknown option ${a} — try: nous --help`);
    else args.push(a);
  }
  if (flags.port !== undefined && !Number.isInteger(flags.port)) die("--port takes a number");
  return { args, flags };
}

/** Everything the page needs, in one object. */
async function payload(cfg: Config, dir: string) {
  const graph: Graph = await scan(dir, {
    groupBy: cfg.group_by,
    exclude: cfg.exclude,
    unresolved: cfg.unresolved,
  });
  const theme = await themes.load(cfg.theme);
  return {
    ...graph,
    theme,
    colors: themes.colorMap(theme, graph.groups),
    physics: cfg.physics,
    title: basename(graph.dir) || "vault",
  };
}

async function resolveDir(cfg: Config, arg?: string): Promise<string> {
  const dir = resolve(expand(arg ?? cfg.dir));
  const stat = await Bun.file(dir).stat().catch(() => null);
  if (!stat?.isDirectory()) {
    die(arg
      ? `no such directory: ${dir}`
      : `dir is not a directory: ${dir}\n  set it in ${CONFIG_FILE}, or run: nous <dir>`);
  }
  return dir;
}

/** One line about anything that will make the graph look wrong. */
function warn(cfg: Config, data: Awaited<ReturnType<typeof payload>>) {
  if (!data.nodes.length) {
    console.error(`nous: no .md files under ${data.dir}`);
    return;
  }
  const grouped = data.nodes.filter((n) => n.group).length;
  if (cfg.group_by !== "folder" && grouped === 0) {
    const seen = data.fields.length ? data.fields.join(", ") : "none";
    console.error(
      `nous: no note has a "${cfg.group_by}" field, so everything is one colour\n` +
      `  fields present: ${seen}\n` +
      `  set group_by in ${CONFIG_FILE}, or use --group-by folder`);
  }
}

async function serve(cfg: Config, dir: string, flags: Flags) {
  const first = flags.port ?? cfg.port;
  let server: ReturnType<typeof Bun.serve> | null = null;
  for (let port = first; port < first + 20 && !server; port++) {
    try {
      server = Bun.serve({
        port,
        idleTimeout: 30,
        async fetch(req) {
          const path = new URL(req.url).pathname;
          if (path === "/") {
            return new Response(page, { headers: { "content-type": "text/html; charset=utf-8" } });
          }
          if (path === "/graph.json") {
            // re-scanned per request, so a browser refresh always shows the vault as it is now
            return Response.json(await payload(cfg, dir));
          }
          return new Response("not found", { status: 404 });
        },
      });
    } catch (e: any) {
      if (e?.code !== "EADDRINUSE") throw e;
    }
  }
  if (!server) die(`ports ${first}-${first + 19} are all busy — try: nous --port 8080`);

  const data = await payload(cfg, dir);
  warn(cfg, data);
  const url = `http://localhost:${server.port}`;
  console.log(
    `${data.title} — ${data.nodes.length} notes, ${data.links.length} links, ` +
    `${data.theme.meta.name}\n${url}   (ctrl-c to stop, refresh to re-read)`);
  if (flags.open) {
    const opener = process.platform === "darwin" ? "open" : "xdg-open";
    Bun.spawn([opener, url], { stdout: "ignore", stderr: "ignore" }).exited.catch(() => {});
  }
}

async function build(cfg: Config, dir: string, out: string, json: boolean) {
  const data = await payload(cfg, dir);
  if (!json) warn(cfg, data);
  const html = page.replace("/*BOOT*/ null", JSON.stringify(data));
  await Bun.write(out, html);
  const bytes = html.length;
  if (json) console.log(JSON.stringify({ file: resolve(out), bytes, notes: data.nodes.length, links: data.links.length }));
  else console.log(`${resolve(out)}  (${data.nodes.length} notes, ${data.links.length} links, ${Math.round(bytes / 1024)}K)`);
}

async function main() {
  // Checked before the flag parser, so `nous --help` and `nous build --help` both
  // answer instead of tripping the unknown-option guard.
  const argv = process.argv.slice(2);
  if (argv.includes("-h") || argv.includes("--help")) return console.log(HELP);
  if (argv.includes("-v") || argv.includes("--version")) return console.log(VERSION);

  const { args, flags } = parseFlags(argv);
  const first = args[0];

  const cfg = await loadConfig();
  if (flags.theme) cfg.theme = flags.theme;
  if (flags.groupBy) cfg.group_by = flags.groupBy;

  if (first === "themes") {
    const names = await themes.list();
    if (flags.json) {
      const rows = await Promise.all(names.map(async (n) => {
        const t = await themes.load(n).catch(() => null);
        return { name: n, title: t?.meta.name ?? null, variant: t?.meta.variant ?? null, active: n === cfg.theme };
      }));
      console.log(JSON.stringify(rows));
    } else {
      for (const n of names) console.log(`${n === cfg.theme ? "*" : " "} ${n}`);
      console.log(`\nthemes live in ${THEMES_DIR} — copy one to make your own`);
    }
    return;
  }

  if (first === "config") {
    const dir = resolve(expand(cfg.dir));
    if (flags.json) console.log(JSON.stringify({ ...cfg, dir, config_file: CONFIG_FILE, themes_dir: THEMES_DIR }));
    else {
      console.log(`config   ${CONFIG_FILE}`);
      console.log(`themes   ${THEMES_DIR}`);
      console.log(`dir      ${dir}`);
      console.log(`group_by ${cfg.group_by}`);
      console.log(`theme    ${cfg.theme}`);
      console.log(`port     ${cfg.port}`);
      console.log(`exclude  ${cfg.exclude.length ? cfg.exclude.join(", ") : "(none)"}`);
    }
    return;
  }

  if (first === "build") {
    const dir = await resolveDir(cfg);
    return build(cfg, dir, args[1] ?? "graph.html", flags.json);
  }

  const dir = await resolveDir(cfg, first);
  return serve(cfg, dir, flags);
}

main().catch((e) => die(e instanceof Error ? e.message : String(e)));
