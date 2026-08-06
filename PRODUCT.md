# nous

A local server that renders any folder of linked markdown as a force graph.
Obsidian's graph view, as a command, on any directory.

## What it is

- `nous.ts` — flags, config, the four commands, the HTTP server.
- `vault.ts` — walks the directory, parses frontmatter, resolves links.
- `theme.ts` — loads a theme TOML, fills defaults, assigns a colour per group.
- `page.html` — the renderer. Embedded in the binary as text, served whole.
- Config `~/.config/nous/config.toml`, themes `~/.config/nous/themes/*.toml`,
  both written on first run. `NOUS_CONFIG` moves them.

## Decisions

- **Generic, not personal.** It reads any vault. The memory store it was written
  for is just what `dir` points at. No personal paths in the shipped scaffold.
- **Own theme format, not swatch's.** Considered reading
  `~/.config/swatch/themes/<name>/palette.toml` for ten free themes and a desktop
  that reskins the graph. Rejected: it couples a public tool to another tool's
  file layout and leaves a stranger with no themes at all.
- **Re-read per request, no watcher.** The page fetches `/graph.json` and the
  server rescans on each call, so refresh is the update mechanism. A watcher and
  a socket would buy a graph that reshapes live, which is worth building only if
  the filming case comes up.
- **Frontmatter is parsed flat.** `metadata:` followed by an indented `type:`
  still yields `type`, because that is what someone means by "group by type".
  Proper YAML nesting would be more correct and less useful.
- **`**` in exclude globs also matches zero folders**, so `**/*.md` catches a
  top-level note.
- **`node_modules` and dot-folders are never scanned.** A vault that happens to
  be a repo would otherwise pull in every dependency README, and an Obsidian
  vault would pull in `.trash`.
- **The `boot()` call is the last line of `page.html`.** In a standalone build
  the data is already inlined, so `boot()` runs with no await to defer it, and
  anything declared below it would still be in its temporal dead zone.

## Known ceilings

- O(n²) repulsion per frame. Fine to a few hundred notes; past that, Barnes-Hut.
- No watch mode, no tags, no attachments, no embeds.
- Obsidian's own `.obsidian/graph.json` is ignored.

## Where it's headed

Nothing planned. Candidates if they ever earn it: watch-and-push for a live
graph, and a demo vault so the README can carry a screenshot that is not a
picture of someone's private notes.
