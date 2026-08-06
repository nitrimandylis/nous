import { expect, test } from "bun:test";
import { mkdtemp, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { matchGlob, parseFrontmatter, scan } from "./vault.ts";
import { colorMap, fromToml, BUILTIN_TOML } from "./theme.ts";

const OPTS = { groupBy: "type", exclude: [] as string[], unresolved: false };

async function vault(files: Record<string, string>) {
  const dir = await mkdtemp(join(tmpdir(), "nous-"));
  for (const [name, body] of Object.entries(files)) {
    const path = join(dir, name);
    if (name.includes("/")) await mkdir(join(path, ".."), { recursive: true });
    await Bun.write(path, body);
  }
  return dir;
}

test("frontmatter is read flat, so nested keys still resolve", () => {
  const { fields, body } = parseFrontmatter(
    `---\nname: swatch\ndescription: "a CLI"\nmetadata:\n  type: project\n---\n\nbody [[other]]\n`);
  expect(fields.name).toBe("swatch");
  expect(fields.description).toBe("a CLI");
  expect(fields.type).toBe("project");
  expect(body.trim()).toBe("body [[other]]");
});

test("a file with no frontmatter is all body", () => {
  const { fields, body } = parseFrontmatter("# title\n[[a]]");
  expect(Object.keys(fields)).toHaveLength(0);
  expect(body).toBe("# title\n[[a]]");
});

test("globs match within and across segments", () => {
  expect(matchGlob("MEMORY.md", "MEMORY.md")).toBe(true);
  expect(matchGlob("*.md", "a.md")).toBe(true);
  expect(matchGlob("*.md", "sub/a.md")).toBe(false);
  expect(matchGlob("**/*.md", "sub/a.md")).toBe(true);
  expect(matchGlob("**/*.md", "a.md")).toBe(true);        // ** also matches zero folders
  expect(matchGlob("drafts/**", "drafts/deep/a.md")).toBe(true);
  expect(matchGlob("drafts/**", "notes/a.md")).toBe(false);
});

test("wikilinks and markdown links both become edges, deduped", async () => {
  const dir = await vault({
    "a.md": "---\ntype: project\n---\n[[b]] and [[b]] again and [c](c.md)",
    "b.md": "---\ntype: note\n---\nback to [[a]]",
    "c.md": "---\ntype: note\n---\nnothing",
  });
  const g = await scan(dir, OPTS);
  expect(g.nodes).toHaveLength(3);
  expect(g.links).toHaveLength(2);            // a-b once despite three mentions, plus a-c
  expect(g.nodes[0].deg).toBe(2);
  expect(g.nodes[1].in).toContain(0);
});

test("self links and external urls are ignored", async () => {
  const dir = await vault({ "a.md": "[[a]] [x](https://example.com/y.md)" });
  const g = await scan(dir, OPTS);
  expect(g.links).toHaveLength(0);
});

test("unresolved links are dropped by default and kept when asked", async () => {
  const dir = await vault({ "a.md": "[[ghost]]" });
  expect((await scan(dir, OPTS)).nodes).toHaveLength(1);

  const withGhosts = await scan(dir, { ...OPTS, unresolved: true });
  expect(withGhosts.nodes).toHaveLength(2);
  expect(withGhosts.nodes[1].ghost).toBe(true);
  expect(withGhosts.links).toHaveLength(1);
});

test("notes carry an mtime, and a note that does not exist yet sorts after them", async () => {
  const dir = await vault({ "old.md": "[[new]] [[ghost]]", "new.md": "hi" });
  // written in the order above, so touching new.md again guarantees the gap
  await Bun.write(join(dir, "new.md"), "hi again");

  const { nodes } = await scan(dir, { ...OPTS, unresolved: true });
  const by = Object.fromEntries(nodes.map((n) => [n.name, n]));
  expect(by.old.mt).toBeGreaterThan(0);
  expect(by.new.mt).toBeGreaterThanOrEqual(by.old.mt);
  expect(by.ghost.ghost).toBe(true);
  expect(by.ghost.mt).toBeGreaterThan(Math.max(by.old.mt, by.new.mt));
});

test("exclude keeps a hub note out of the graph entirely", async () => {
  const dir = await vault({
    "INDEX.md": "[[a]] [[b]]",
    "a.md": "hi",
    "b.md": "hi",
  });
  expect((await scan(dir, OPTS)).links).toHaveLength(2);
  expect((await scan(dir, { ...OPTS, exclude: ["INDEX.md"] })).links).toHaveLength(0);
});

test("links resolve across folders by basename and by path", async () => {
  const dir = await vault({
    "top.md": "[[deep/inner]] and [[other]]",
    "deep/inner.md": "x",
    "deep/other.md": "x",
  });
  const g = await scan(dir, OPTS);
  expect(g.links).toHaveLength(2);
});

test("dependency trees and hidden folders are never notes", async () => {
  const dir = await vault({
    "a.md": "real",
    "node_modules/pkg/README.md": "not a note",
    ".obsidian/plugin/doc.md": "not a note",
    ".trash/deleted.md": "not a note",
  });
  const g = await scan(dir, OPTS);
  expect(g.nodes.map((n) => n.name)).toEqual(["a"]);
});

test("group_by folder buckets by the first path segment", async () => {
  const dir = await vault({ "one/a.md": "x", "two/b.md": "x", "c.md": "x" });
  const g = await scan(dir, { ...OPTS, groupBy: "folder" });
  expect(g.groups.sort()).toEqual(["one", "root", "two"]);
});

test("groups come back most-common first", async () => {
  const dir = await vault({
    "a.md": "---\ntype: project\n---\n",
    "b.md": "---\ntype: project\n---\n",
    "c.md": "---\ntype: note\n---\n",
  });
  expect((await scan(dir, OPTS)).groups).toEqual(["project", "note"]);
});

test("the shipped theme parses and fills every field", () => {
  const t = fromToml(Bun.TOML.parse(BUILTIN_TOML));
  expect(t.colors.bg).toBe("#0d0a1e");
  expect(t.groups.project).toBe("#00d4ff");
  expect(t.groups.cycle).toBeUndefined();     // cycle is not a group
  expect(t.cycle.length).toBeGreaterThan(4);
  expect(t.feel.duotone).toEqual(["#ff1f6b", "#00d4ff"]);
});

test("a sparse theme keeps the defaults it did not set", () => {
  const t = fromToml(Bun.TOML.parse(`[colors]\nbg = "#000000"\n[feel]\nhalftone = false\n`));
  expect(t.colors.bg).toBe("#000000");
  expect(t.colors.text).toBe("#ece9f7");
  expect(t.feel.halftone).toBe(false);
  expect(t.feel.glow).toBe(true);
});

test("duotone = false disables it rather than falling back to the default", () => {
  expect(fromToml(Bun.TOML.parse(`[feel]\nduotone = false\n`)).feel.duotone).toBe(false);
});

test("mapped groups keep their colour, unmapped ones never collide with them", () => {
  const t = fromToml(Bun.TOML.parse(BUILTIN_TOML));
  const map = colorMap(t, ["project", "wild", "loose"]);
  expect(map.project).toBe("#00d4ff");     // explicitly mapped
  expect(map.wild).not.toBe(map.loose);
  expect(map.wild).not.toBe(map.project);  // free to reuse "feedback"'s colour: no feedback here
  expect(map.loose).not.toBe(map.project);
});

test("a vault matching none of the theme's names still gets the good colours", () => {
  // The failure this guards against: reserving every colour the theme mentions
  // leaves an unrelated vault with only the dregs of the cycle.
  const t = fromToml(Bun.TOML.parse(BUILTIN_TOML));
  const map = colorMap(t, ["concept", "algorithm", "person", "dataset"]);
  expect(map.algorithm).toBe(t.cycle[0]);   // alphabetical, not most-common-first
  expect(map.concept).toBe(t.cycle[1]);
  expect(map.dataset).toBe(t.cycle[2]);
  expect(map.person).toBe(t.cycle[3]);
});

test("writing more notes never repaints the groups already there", () => {
  // groups arrive most-common-first, so the order flips as a vault grows. Colour
  // has to follow the name, or every note added reshuffles the legend.
  const t = fromToml(Bun.TOML.parse(BUILTIN_TOML));
  const before = colorMap(t, ["concept", "algorithm"]);
  const after = colorMap(t, ["algorithm", "concept"]);   // algorithm overtook concept
  expect(after).toEqual(before);
});

test("more groups than colours wraps rather than going undefined", () => {
  const t = fromToml(Bun.TOML.parse(`[groups]\ncycle = ["#111111", "#222222"]\n`));
  const map = colorMap(t, ["a", "b", "c"]);
  expect(Object.values(map).every((c) => typeof c === "string" && c.length > 0)).toBe(true);
});

test("a theme that pins no group falls to its own cycle, not the builtin's", () => {
  const t = fromToml(Bun.TOML.parse(`[groups]\ncycle = ["#111111", "#222222"]\n`));
  expect(colorMap(t, ["project", "feedback"])).toEqual({ feedback: "#111111", project: "#222222" });
});
