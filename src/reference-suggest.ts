import {
  EditorSuggest,
  Notice,
  prepareFuzzySearch,
  sortSearchResults,
  type Editor,
  type EditorChange,
  type EditorPosition,
  type EditorSuggestContext,
  type EditorSuggestTriggerInfo,
  type Plugin,
  type SearchResult,
  type TFile,
} from "obsidian";

import {
  addBlockId,
  collectBlockIds,
  createUniqueBlockId,
} from "./block-id";
import type { BlockIndex } from "./block-index";
import { blockBodyPreview, blockDisplayName } from "./block-name";
import { parseBlocks, type ParsedBlock } from "./parser";
import type { BlockDefinition } from "./settings-model";

interface IndexedBlock {
  file: TFile;
  block: ParsedBlock;
}

interface PreparedReference {
  block: ParsedBlock;
  id: string;
}

interface ScoredReference {
  item: IndexedBlock;
  match: SearchResult;
}

function triggerIndex(text: string): number {
  const index = text.lastIndexOf("\\ref");
  if (index < 0) {
    return -1;
  }
  const preceding = text[index - 1];
  return preceding === undefined || /[\s([{]/u.test(preceding) ? index : -1;
}

function prepareReference(
  markdown: string,
  selected: ParsedBlock,
  definitions: readonly BlockDefinition[],
): PreparedReference {
  const block = parseBlocks(markdown, definitions).find((candidate) =>
    selected.id
      ? candidate.id === selected.id
      : candidate.fromLine === selected.fromLine &&
        candidate.type === selected.type &&
        candidate.label === selected.label &&
        candidate.body === selected.body,
  );
  if (!block) {
    throw new Error("Target block is no longer available.");
  }
  return {
    block,
    id: block.id ?? createUniqueBlockId(block, collectBlockIds(markdown)),
  };
}

function safeAlias(value: string): string {
  return value
    .replaceAll("|", "-")
    .replaceAll("[[", "(")
    .replaceAll("]]", ")");
}

export class ReferenceSuggest extends EditorSuggest<IndexedBlock> {
  constructor(
    private readonly plugin: Plugin,
    private readonly index: BlockIndex,
    private readonly getDefinitions: () => readonly BlockDefinition[],
  ) {
    super(plugin.app);
    this.limit = 20;
    this.setInstructions([
      { command: "↵", purpose: "insert reference" },
    ]);
  }

  onTrigger(
    cursor: EditorPosition,
    editor: Editor,
  ): EditorSuggestTriggerInfo | null {
    const text = editor.getLine(cursor.line).slice(0, cursor.ch);
    const index = triggerIndex(text);
    if (index < 0) {
      return null;
    }

    const rawQuery = text.slice(index + "\\ref".length);
    if (["[", "]", "{", "}", "\\"].some((character) =>
      rawQuery.includes(character)
    )) {
      return null;
    }

    return {
      start: { line: cursor.line, ch: index },
      end: cursor,
      query: rawQuery.trimStart(),
    };
  }

  async getSuggestions(context: EditorSuggestContext): Promise<IndexedBlock[]> {
    const markdown = context.editor.getValue();
    const items = (await Promise.all(
      this.plugin.app.vault.getMarkdownFiles().map(async (file) => {
        const blocks = file.path === context.file.path
          ? parseBlocks(markdown, this.getDefinitions())
          : (await this.index.getDocument(file)).blocks;
        return blocks.map((block) => ({ file, block }));
      }),
    )).flat();
    const query = context.query.trim();
    if (!query) {
      return items.sort((left, right) => {
        const leftActive = left.file.path === context.file.path ? 0 : 1;
        const rightActive = right.file.path === context.file.path ? 0 : 1;
        return leftActive - rightActive ||
          left.file.path.localeCompare(right.file.path) ||
          left.block.fromLine - right.block.fromLine;
      });
    }

    const search = prepareFuzzySearch(query);
    const results: ScoredReference[] = [];
    for (const item of items) {
      const text = [
        blockDisplayName(item.block),
        item.file.path,
        item.block.body,
      ].join(" ");
      const match = search(text);
      if (match) {
        results.push({ item, match });
      }
    }
    sortSearchResults(results);
    return results.map(({ item }) => item);
  }

  renderSuggestion(item: IndexedBlock, element: HTMLElement): void {
    element.createDiv({
      cls: "suggestion-title",
      text: blockDisplayName(item.block),
    });
    const details = [
      `${item.file.path}:${item.block.fromLine + 1}`,
      blockBodyPreview(item.block),
    ].filter(Boolean);
    element.createDiv({
      cls: "suggestion-note",
      text: details.join(" · "),
    });
  }

  selectSuggestion(item: IndexedBlock, _event: MouseEvent | KeyboardEvent): void {
    void this.insertReference(item);
  }

  private async insertReference(item: IndexedBlock): Promise<void> {
    const context = this.context;
    if (!context) {
      return;
    }

    const source = context.editor.getValue();
    const local = item.file.path === context.file.path;
    const changes: EditorChange[] = [];
    try {
      let target!: PreparedReference;
      if (local) {
        target = prepareReference(source, item.block, this.getDefinitions());
        if (!target.block.id) {
          changes.push({
            from: context.editor.offsetToPos(target.block.to),
            text: ` ^${target.id}`,
          });
        }
      } else if (item.block.id) {
        const markdown = await this.plugin.app.vault.cachedRead(item.file);
        target = prepareReference(markdown, item.block, this.getDefinitions());
      } else {
        await this.plugin.app.vault.process(item.file, (markdown) => {
          target = prepareReference(markdown, item.block, this.getDefinitions());
          return addBlockId(markdown, target.block, target.id);
        });
      }

      if (context.editor.getValue() !== source) {
        throw new Error("The source text changed while preparing the reference.");
      }
      const filePart = local
        ? ""
        : this.plugin.app.metadataCache.fileToLinktext(
          item.file,
          context.file.path,
        );
      const alias = safeAlias(blockDisplayName(target.block));
      changes.push({
        from: context.start,
        to: context.end,
        text: `[[${filePart}#^${target.id}|${alias}]]`,
      });
      changes.sort((left, right) =>
        left.from.line - right.from.line || left.from.ch - right.from.ch,
      );
      context.editor.transaction({ changes });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to create reference.";
      new Notice(`${this.plugin.manifest.name}: ${message}`);
    }
  }
}
