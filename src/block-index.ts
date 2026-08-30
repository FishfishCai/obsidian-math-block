import {
  TFile,
  type App,
  type Plugin,
} from "obsidian";

import {
  parseBlocks,
  type ParsedBlock,
} from "./parser";
import type { BlockDefinition } from "./settings-model";

interface IndexedDocument {
  markdown: string;
  blocks: ParsedBlock[];
}

interface CacheEntry {
  modifiedTime: number;
  document: Promise<IndexedDocument>;
}

export class BlockIndex {
  private readonly cache = new Map<string, CacheEntry>();

  constructor(
    private readonly app: App,
    private readonly getDefinitions: () => readonly BlockDefinition[],
  ) {}

  register(plugin: Plugin): void {
    plugin.registerEvent(
      this.app.vault.on("modify", (file) => {
        this.cache.delete(file.path);
      }),
    );
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
    const document = this.app.vault.cachedRead(file).then((markdown) => ({
      markdown,
      blocks: parseBlocks(markdown, this.getDefinitions()),
    }));
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

  clear(): void {
    this.cache.clear();
  }
}
