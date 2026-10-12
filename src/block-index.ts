import {
  TFile,
  type App,
  type Plugin,
} from "obsidian";

import { lineStarts, savedLineOffset } from "./markdown-section";
import {
  parseBlocks,
  type ParsedBlock,
} from "./parser";
import type { BlockDefinition } from "./settings-model";

export class IndexedDocument {
  private starts: number[] | null = null;

  constructor(
    readonly markdown: string,
    readonly blocks: ParsedBlock[],
  ) {}

  // Reading view slices notes by line, so the line table waits for it.
  lineRange(lineStart: number, lineEnd: number): { from: number; to: number } {
    this.starts ??= lineStarts(this.markdown);
    const next = this.starts[lineEnd + 1];
    return {
      from: this.starts[lineStart]!,
      to: next === undefined ? this.markdown.length : next - 1,
    };
  }
}

interface CacheEntry {
  modifiedTime: number;
  document: Promise<IndexedDocument>;
}

interface LocatedSlice {
  text: string;
  note: IndexedDocument;
  line: number | null;
}

export class BlockIndex {
  private readonly cache = new Map<string, CacheEntry>();
  private lastText: IndexedDocument | null = null;
  private lastSlice: LocatedSlice | null = null;

  constructor(
    private readonly app: App,
    private readonly getDefinitions: () => readonly BlockDefinition[],
  ) {}

  // Modified files miss the cache by mtime; these events drop dead paths.
  register(plugin: Plugin): void {
    plugin.registerEvent(
      this.app.vault.on("delete", (file) => {
        if (file instanceof TFile) {
          this.cache.delete(file.path);
        } else {
          this.cache.clear();
        }
      }),
    );
    plugin.registerEvent(
      this.app.vault.on("rename", (file, oldPath) => {
        if (file instanceof TFile) {
          this.cache.delete(oldPath);
        } else {
          this.cache.clear();
        }
      }),
    );
  }

  getDocument(file: TFile): Promise<IndexedDocument> {
    const cached = this.cache.get(file.path);
    if (cached && cached.modifiedTime === file.stat.mtime) {
      return cached.document;
    }

    const path = file.path;
    const document = this.app.vault.cachedRead(file).then((markdown) =>
      new IndexedDocument(markdown, parseBlocks(markdown, this.getDefinitions()))
    );
    const entry: CacheEntry = {
      modifiedTime: file.stat.mtime,
      document,
    };
    this.cache.set(path, entry);
    void document.catch(() => {
      if (this.cache.get(path) === entry) {
        this.cache.delete(path);
      }
    });
    return document;
  }

  // Reading views render many sections from the same unsaved text.
  parseText(markdown: string): IndexedDocument {
    if (this.lastText?.markdown !== markdown) {
      this.lastText = new IndexedDocument(
        markdown,
        parseBlocks(markdown, this.getDefinitions()),
      );
    }
    return this.lastText;
  }

  // Every section of a view carries the same text, so locate it once.
  sliceLine(text: string, note: IndexedDocument): number | null {
    if (this.lastSlice?.text !== text || this.lastSlice.note !== note) {
      this.lastSlice = {
        text,
        note,
        line: savedLineOffset(text, note.markdown),
      };
    }
    return this.lastSlice.line;
  }

  clear(): void {
    this.cache.clear();
    this.lastText = null;
    this.lastSlice = null;
  }
}
