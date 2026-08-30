import { EditorState } from "@codemirror/state";
import { EditorView, type WidgetType } from "@codemirror/view";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  Notice,
  TFile,
  editorInfoField,
  editorLivePreviewField,
  type App,
  type Editor,
  type EditorPosition,
  type EditorTransaction,
  type Plugin,
} from "obsidian";

import { BlockIndex } from "../src/block-index";
import { createBlockEditorExtension } from "../src/editor-extension";
import { parseBlocks } from "../src/parser";
import * as parser from "../src/parser";
import { ReferenceSuggest } from "../src/reference-suggest";
import { DEFAULT_BLOCK_DEFINITIONS } from "../src/settings-model";

const editorContext = vi.hoisted(() => ({ path: "A.md", live: true }));

vi.mock("obsidian", async () => {
  const { StateField } = await import("@codemirror/state");
  return {
    TFile: class {},
    Notice: vi.fn(),
    MarkdownRenderChild: class {},
    editorInfoField: StateField.define({
      create: () => ({ file: { path: editorContext.path } }),
      update: () => ({ file: { path: editorContext.path } }),
    }),
    editorLivePreviewField: StateField.define({
      create: () => editorContext.live,
      update: () => editorContext.live,
    }),
    EditorSuggest: class {
      context = null;
      setInstructions() {}
    },
  };
});

vi.mock("../src/render", () => ({ renderBlock: vi.fn(async () => {}) }));

function file(path: string): TFile {
  return Object.assign(new TFile(), {
    path,
    extension: "md",
    stat: { mtime: 1, ctime: 1, size: 0 },
  });
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function editor(markdown: string) {
  let state = EditorState.create({ doc: markdown });
  const offset = (position: EditorPosition) =>
    state.doc.line(position.line + 1).from + position.ch;
  const transaction = vi.fn((tx: EditorTransaction) => {
    const changes = (tx.changes ?? []).map((change) => ({
      from: offset(change.from),
      to: offset(change.to ?? change.from),
      insert: change.text,
    }));
    state = state.update({ changes }).state;
  });
  const api = {
    getValue: () => state.doc.toString(),
    offsetToPos: (position: number) => {
      const line = state.doc.lineAt(position);
      return { line: line.number - 1, ch: position - line.from };
    },
    replaceRange: (text: string, from: EditorPosition, to = from) => {
      state = state.update({ changes: { from: offset(from), to: offset(to), insert: text } }).state;
    },
    transaction,
  };
  return { api: api as unknown as Editor, transaction };
}

beforeEach(() => {
  vi.clearAllMocks();
  editorContext.path = "A.md";
  editorContext.live = true;
});
afterEach(() => vi.restoreAllMocks());

describe("block index", () => {
  it("shares a pending read between callers", async () => {
    const pending = deferred<string>();
    const cachedRead = vi.fn(() => pending.promise);
    const index = new BlockIndex({ vault: { cachedRead } } as unknown as App, () => DEFAULT_BLOCK_DEFINITIONS);
    const target = file("A.md");
    const first = index.getDocument(target);
    const second = index.getDocument(target);
    expect(cachedRead).toHaveBeenCalledTimes(1);
    pending.resolve("::: theorem\nabc\n:::");
    expect(await first).toBe(await second);
  });

  it("keeps the newer read when an older read finishes last", async () => {
    const oldRead = deferred<string>();
    const newRead = deferred<string>();
    const cachedRead = vi.fn().mockReturnValueOnce(oldRead.promise).mockReturnValueOnce(newRead.promise);
    const index = new BlockIndex({ vault: { cachedRead } } as unknown as App, () => DEFAULT_BLOCK_DEFINITIONS);
    const target = file("A.md");
    const first = index.getDocument(target);
    target.stat.mtime = 2;
    const second = index.getDocument(target);
    newRead.resolve("new");
    await second;
    oldRead.resolve("old");
    await first;
    expect((await index.getDocument(target)).markdown).toBe("new");
  });

  it("allows a fresh read after an I/O failure", async () => {
    const cachedRead = vi.fn().mockRejectedValueOnce(new Error("read failed")).mockResolvedValueOnce("new");
    const index = new BlockIndex({ vault: { cachedRead } } as unknown as App, () => DEFAULT_BLOCK_DEFINITIONS);
    const target = file("A.md");
    await expect(index.getDocument(target)).rejects.toThrow("read failed");
    expect((await index.getDocument(target)).markdown).toBe("new");
  });
});

describe("reference insertion", () => {
  function setup(markdown: string, disk = markdown) {
    const current = file("A.md");
    const source = editor(markdown);
    const vault = {
      getMarkdownFiles: vi.fn(() => [current]),
      cachedRead: vi.fn(async () => disk),
      process: vi.fn(async (_file: TFile, update: (text: string) => string) => {
        disk = update(disk);
        return disk;
      }),
    };
    const plugin = {
      app: { vault, metadataCache: { fileToLinktext: (target: TFile) => target.path.replace(/\.md$/u, "") } },
      manifest: { name: "Math Block" },
    } as unknown as Plugin;
    const index = new BlockIndex(plugin.app, () => DEFAULT_BLOCK_DEFINITIONS);
    const suggest = new ReferenceSuggest(plugin, index, () => DEFAULT_BLOCK_DEFINITIONS);
    suggest.context = {
      file: current,
      editor: source.api,
      start: { line: 0, ch: 0 },
      end: { line: 0, ch: 4 },
      query: "",
    };
    return { current, source, vault, suggest };
  }

  it("includes the active editor's unsaved blocks in completion", async () => {
    const { suggest } = setup("\\ref\n\n::: theorem:New\nabc\n:::", "");
    const items = await suggest.getSuggestions(suggest.context!);
    expect(items.map((item) => item.block.label)).toEqual(["New"]);
  });

  it("inserts the local ID and link as one editor transaction", async () => {
    const markdown = "\\ref\n\n::: theorem:A\nabc\n:::";
    const { current, source, vault, suggest } = setup(markdown);
    suggest.selectSuggestion({ file: current, block: parseBlocks(markdown)[0]! }, {} as KeyboardEvent);
    await vi.waitFor(() => expect(source.transaction).toHaveBeenCalledTimes(1));
    expect(vault.process).not.toHaveBeenCalled();
    expect(source.api.getValue()).toBe("[[#^a|Theorem 1 (A)]]\n\n::: theorem:A\nabc\n::: ^a");
  });

  it("rejects a reference to a target removed after completion", async () => {
    const old = "\\ref\n\n::: theorem:A\nabc\n::: ^a";
    const { current, source, suggest } = setup("\\ref");
    suggest.selectSuggestion({ file: current, block: parseBlocks(old)[0]! }, {} as KeyboardEvent);
    await vi.waitFor(() => expect(Notice).toHaveBeenCalled());
    expect(source.api.getValue()).toBe("\\ref");
  });

  it("keeps local edit positions correct when the ID comes before the query", async () => {
    const markdown = "::: theorem:A\nabc\n:::\n\n\\ref";
    const { current, source, suggest } = setup(markdown);
    suggest.context!.start = { line: 4, ch: 0 };
    suggest.context!.end = { line: 4, ch: 4 };
    suggest.selectSuggestion({ file: current, block: parseBlocks(markdown)[0]! }, {} as KeyboardEvent);
    await vi.waitFor(() => expect(source.transaction).toHaveBeenCalledTimes(1));
    expect(source.api.getValue()).toBe("::: theorem:A\nabc\n::: ^a\n\n[[#^a|Theorem 1 (A)]]");
  });

  it("uses an atomic vault update for a new cross-file ID", async () => {
    const markdown = "::: theorem:B\nabc\n:::";
    const { source, vault, suggest } = setup("\\ref", markdown);
    suggest.selectSuggestion({ file: file("B.md"), block: parseBlocks(markdown)[0]! }, {} as KeyboardEvent);
    await vi.waitFor(() => expect(source.transaction).toHaveBeenCalledTimes(1));
    expect(vault.process).toHaveBeenCalledTimes(1);
    expect(await vault.cachedRead()).toBe("::: theorem:B\nabc\n::: ^b");
    expect(source.api.getValue()).toBe("[[B#^b|Theorem 1 (B)]]");
  });

  it("leaves the target file untouched when it already has an ID", async () => {
    const markdown = "::: theorem:B\nabc\n::: ^b";
    const { source, vault, suggest } = setup("\\ref", markdown);
    suggest.selectSuggestion({ file: file("B.md"), block: parseBlocks(markdown)[0]! }, {} as KeyboardEvent);
    await vi.waitFor(() => expect(source.transaction).toHaveBeenCalledTimes(1));
    expect(vault.process).not.toHaveBeenCalled();
    expect(source.api.getValue()).toBe("[[B#^b|Theorem 1 (B)]]");
  });

  it("preserves user edits made while a cross-file target is loading", async () => {
    const markdown = "::: theorem:B\nabc\n::: ^b";
    const pending = deferred<string>();
    const { source, vault, suggest } = setup("\\ref", markdown);
    vault.cachedRead.mockReturnValueOnce(pending.promise);
    suggest.selectSuggestion({ file: file("B.md"), block: parseBlocks(markdown)[0]! }, {} as KeyboardEvent);
    source.api.replaceRange("abc", { line: 0, ch: 0 }, { line: 0, ch: 4 });
    pending.resolve(markdown);
    await vi.waitFor(() => expect(Notice).toHaveBeenCalled());
    expect(source.transaction).not.toHaveBeenCalled();
    expect(source.api.getValue()).toBe("abc");
  });
});

describe("Live Preview state", () => {
  function setup(plugin = {} as Plugin) {
    let definitions = structuredClone([...DEFAULT_BLOCK_DEFINITIONS]);
    const state = EditorState.create({
      doc: "# A\n\n::: theorem:B\nabc\n:::",
      extensions: [
        editorInfoField,
        editorLivePreviewField,
        createBlockEditorExtension(plugin, () => definitions),
      ],
    });
    return {
      state,
      changeFont: () => {
        definitions.find((block) => block.type === "theorem")!.body.family = "Georgia";
        definitions = [...definitions];
      },
    };
  }

  function widgets(state: EditorState): WidgetType[] {
    const found: WidgetType[] = [];
    for (const decorations of state.facet(EditorView.decorations)) {
      if (typeof decorations === "function") continue;
      decorations.between(0, state.doc.length, (_from, _to, decoration) => {
        const { widget } = decoration.spec as { widget?: WidgetType };
        if (widget) found.push(widget);
      });
    }
    return found;
  }

  it("reuses parsed blocks during cursor movement", () => {
    const parse = vi.spyOn(parser, "parseBlocks");
    let { state } = setup();
    expect(parse).toHaveBeenCalledTimes(1);
    state = state.update({ selection: { anchor: 1 } }).state;
    expect(parse).toHaveBeenCalledTimes(1);
    state = state.update({ changes: { from: 0, insert: "x" } }).state;
    expect(parse).toHaveBeenCalledTimes(2);
    expect(state.doc.toString().startsWith("x")).toBe(true);
  });

  it("replaces a widget after typography changes", () => {
    const { state, changeFont } = setup();
    const before = widgets(state)[0]!;
    changeFont();
    const after = widgets(state.update({}).state)[0]!;
    expect(before.eq(after)).toBe(false);
  });

  it("uses a new widget when the source file changes", () => {
    const { state } = setup();
    const before = widgets(state)[0]!;
    editorContext.path = "B.md";
    const after = widgets(state.update({}).state)[0]!;
    expect(before.eq(after)).toBe(false);
  });

  it("unloads the renderer when CodeMirror reuses a widget's DOM", () => {
    const plugin = { addChild: vi.fn(), removeChild: vi.fn() };
    const { state } = setup(plugin as unknown as Plugin);
    const container = { addEventListener: vi.fn() };
    const view = { dom: { win: { createDiv: () => container } } };
    const before = widgets(state)[0]!;
    const dom = before.toDOM(view as unknown as EditorView);
    const after = widgets(state.update({ selection: { anchor: 1 } }).state)[0]!;
    expect(before.eq(after)).toBe(true);
    after.destroy(dom);
    expect(plugin.removeChild).toHaveBeenCalledWith(plugin.addChild.mock.calls[0]![0]);
  });

  it("leaves secondary mouse clicks to the native context menu", () => {
    const plugin = { addChild: vi.fn(), removeChild: vi.fn() };
    const { state } = setup(plugin as unknown as Plugin);
    const container = { addEventListener: vi.fn() };
    const view = {
      dom: { win: { createDiv: () => container } },
      dispatch: vi.fn(),
    };
    const widget = widgets(state)[0]!;
    const dom = widget.toDOM(view as unknown as EditorView);
    const listener = container.addEventListener.mock.calls[0]![1] as (event: MouseEvent) => void;
    const event = { button: 2, targetNode: null, preventDefault: vi.fn() };
    expect(widget.ignoreEvent(event as unknown as MouseEvent)).toBe(true);
    listener(event as unknown as MouseEvent);
    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(view.dispatch).not.toHaveBeenCalled();
    widget.destroy(dom);
  });

  it("keeps multiple block decorations in source order", () => {
    const { state } = setup();
    const updated = state.update({
      changes: { from: state.doc.length, insert: "\n\n::: note\nxyz\n:::" },
    }).state;
    expect(widgets(updated)).toHaveLength(2);
  });

  it("shows source while the selection touches a block or Live Preview is off", () => {
    const { state } = setup();
    expect(widgets(state)).toHaveLength(1);
    expect(widgets(state.update({ selection: { anchor: 6 } }).state)).toEqual([]);
    editorContext.live = false;
    expect(widgets(state.update({}).state)).toEqual([]);
  });
});
