---
name: nous-cli
description: Drive the nous CLI — renders a folder of linked markdown (an Obsidian vault, a memory store, a docs tree) as a force graph, served on localhost or written to a standalone HTML file. Use when the user wants to see, visualise, or share the link structure of their notes, mentions nous, a note graph, a vault graph or a knowledge graph, or asks which notes are most linked, orphaned, or clustered.
---

# nous

`nous` reads every `.md` file under a directory, follows the `[[wikilinks]]` and
relative markdown links between them, and draws the result as a force graph.

## Setup

The binary is at `~/.bun/bin/nous`. If it is not on PATH, run `bun run nous.ts`
from the repo instead — every command below works the same way.

Config is `~/.config/nous/config.toml`, written on first run. `NOUS_CONFIG`
points at a different config directory, which is the clean way to try settings
without touching the user's own.

## Never spawn the server

`nous` with no subcommand **starts a server and does not exit**. Running it from a
tool call hangs until the call times out, and it opens a browser window on the
user's machine. Do not run it. Hand the user the command instead:

```
nous              # their configured vault
nous ~/some/dir   # a specific one
```

Everything below is safe to run unattended.

## Commands an agent can use

| command | what it does |
|---|---|
| `nous build <file> --json` | writes a standalone HTML graph, prints `{file, bytes, notes, links}` |
| `nous themes --json` | array of `{name, title, variant, active}` |
| `nous config --json` | resolved config plus `dir`, `config_file`, `themes_dir` |

`build` reads the vault named by `dir` in the config. It does not take a
directory argument — its argument is the **output file**. To graph a different
vault, edit `dir` in the config or serve it by path.

To answer questions about the vault's structure (most linked, orphans, clusters),
`build --json` only reports counts. Read the vault yourself, or build to a temp
file and parse the `const BOOT = {...}` object out of the HTML, which contains
every node with its `deg`, `in` and `out` arrays.

## Things that will bite you

- **`build`'s argument is the output path, not the vault.** `nous build ~/notes`
  writes an HTML file called `notes` in the home directory. It does not graph it.
- **`group_by` names a frontmatter field, and nested YAML still counts.** The
  parser reads frontmatter as flat `key: value` lines, so a `type` nested under
  `metadata:` is found. If no note has the field, every node is one colour and
  nous says so on stderr — that message is the fix, read it.
- **An index note that links to everything ruins the graph.** It renders as one
  hub with a spoke to every note. Put it in `exclude`.
- **Unresolved links are dropped silently** unless `unresolved = true`. A vault
  full of planned-but-unwritten notes will look sparser than it reads.
- **Themes are files, and the file name is the theme name.** `theme = "x"` with no
  `~/.config/nous/themes/x.toml` is an error, not a fallback. The one exception is the
  builtin `spider-verse`, which still resolves from the copy inside nous if its file is deleted.
- **stdout is the payload with `--json`, warnings go to stderr.** Do not parse
  stderr as JSON.

## What it cannot do

- It never writes to the vault. There is no way to create, edit or delete a note.
- There is no watch mode. The served page re-reads on refresh; a built file is a
  snapshot.
- It does not read Obsidian's own `.obsidian/graph.json`. Colours and physics come
  from nous's config and themes only.
- It does not render tags, attachments, or embeds — only notes and the links
  between them.
