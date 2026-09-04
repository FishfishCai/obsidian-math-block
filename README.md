# Math Block

An Obsidian plugin for mathematical blocks using `:::` syntax. It supports native block links and embeds, custom block types, configurable typography, a shared counter, and `\ref` completion.

## Syntax

```markdown
::: block-name:title
content.
::: ^block-name-title
```

Write the title after the colon and the block ID on the closing line.
Leave a blank line between blocks so Obsidian can index the block ID.

## References

Type `\ref` to search Math Block entries. Selecting a result inserts a native `[[#^block-id|name]]` link. If the target has no block ID, the plugin adds a unique ID to its closing line.

- Current file: [[#^definition-a|Definition 1 (A)]]
- Hover preview: hover in Reading view; hold `Cmd` on macOS or `Ctrl` on Windows/Linux while hovering in Live Preview
- Embed: `![[#^theorem-b]]`

Navigation, embeds, backlinks, file-rename updates, and modifier-key behavior are handled by Obsidian.

## Settings

### Blocks

Each row defines a block name, its title and body typography, and whether it uses the shared counter. Font-family fields accept CSS `font-family` values directly; the default is `"Times New Roman", serif`. Use the **B** and **I** controls for bold and italic.

Proof is fixed, cannot be deleted, and is never numbered. Other rows can be edited, removed, or added.

| Name | Title | Body | Numbered |
| --- | --- | --- | --- |
| proof | Times New Roman · I | Times New Roman | — |
| definition | Times New Roman · B | Times New Roman | Yes |
| theorem | Times New Roman · B | Times New Roman · I | Yes |
| proposition | Times New Roman · B | Times New Roman · I | Yes |
| lemma | Times New Roman · B | Times New Roman · I | Yes |
| corollary | Times New Roman · B | Times New Roman · I | Yes |
| example | Times New Roman · B | Times New Roman | Yes |
| note | Times New Roman · B | Times New Roman | No |

## Default block types

::: proof
abc.
::: ^proof

::: definition:A
abc.
::: ^definition-a

::: theorem:B
def.
::: ^theorem-b

::: proposition:C
ghi.
::: ^proposition-c

::: lemma:D
jkl.
::: ^lemma-d

::: corollary:E
mno.
::: ^corollary-e

::: example:F
pqr.
::: ^example-f

::: note:G
stu.
::: ^note-g

## Installation

Place `main.js`, `manifest.json`, and `styles.css` in:

```text
<vault>/.obsidian/plugins/math-block/
```

Then enable **Math Block** under **Community plugins** in Obsidian.

## Development

```bash
pnpm install
pnpm check
```
