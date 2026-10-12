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
  type MarkdownPostProcessorContext,
  type Plugin,
} from "obsidian";

import { BlockIndex, IndexedDocument } from "../src/block-index";
import { createBlockEditorExtension } from "../src/editor-extension";
import { parseBlocks } from "../src/parser";
import * as parser from "../src/parser";
import { processReadingModeBlocks } from "../src/reading-mode";
import { ReferenceSuggest } from "../src/reference-suggest";
import { renderBlock } from "../src/render";
import { DEFAULT_BLOCK_DEFINITIONS } from "../src/settings-model";

function parse(markdown: string) {
  return parseBlocks(markdown, DEFAULT_BLOCK_DEFINITIONS);
}

const editorContext = vi.hoisted(() => ({ path: "A.md", live: true }));
const renderMarkdown = vi.hoisted(() => vi.fn(async () => {}));

vi.mock("obsidian", async () => {
  const { StateField } = await import("@codemirror/state");
  return {
    TFile: class {},
    Notice: vi.fn(),
    MarkdownRenderChild: class {},
    MarkdownRenderer: { render: renderMarkdown },
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

  it("parses unsaved text once until it changes or the index clears", () => {
    const index = new BlockIndex({} as App, () => DEFAULT_BLOCK_DEFINITIONS);
    const text = "::: theorem\nabc\n:::";
    const first = index.parseText(text);
    expect(first.blocks.map((block) => block.number)).toEqual([1]);
    expect(index.parseText(text)).toBe(first);
    expect(index.parseText(`${text}\n`)).not.toBe(first);
    const current = index.parseText(text);
    index.clear();
    expect(index.parseText(text)).not.toBe(current);
  });

  it("locates an embed's text once for all its sections", () => {
    const index = new BlockIndex({} as App, () => DEFAULT_BLOCK_DEFINITIONS);
    const note = index.parseText("# A\n\n::: theorem\nabc\n:::\n");
    const indexOf = vi.spyOn(String.prototype, "indexOf");
    const section = "::: theorem\nabc\n:::";
    expect(index.sliceLine(section, note)).toBe(2);
    const calls = indexOf.mock.calls.length;
    expect(index.sliceLine(section, note)).toBe(2);
    expect(indexOf.mock.calls.length).toBe(calls);
    expect(() => index.sliceLine("::: lemma\nxyz\n:::", note)).toThrow();
  });
});

describe("indexed document", () => {
  it("slices whole lines and keeps CRLF content", () => {
    const markdown = "# A\r\n\r\n::: theorem\r\nabc\r\n:::";
    const document = new IndexedDocument(markdown, parse(markdown));
    const { from, to } = document.lineRange(2, 3);
    expect(markdown.slice(from, to)).toBe("::: theorem\r\nabc\r");
    const tail = document.lineRange(4, 4);
    expect(markdown.slice(tail.from, tail.to)).toBe(":::");
  });
});

describe("Reading view", () => {
  const saved = [
    "::: definition:A",
    "abc",
    ":::",
    "",
    "# B",
    "",
    "::: theorem:B",
    "before",
    "$$",
    "x",
    "$$",
    "after",
    "::: ^b",
  ].join("\n");

  function render(
    section: { text: string; lineStart: number; lineEnd: number },
    embedded: boolean,
  ) {
    const created: string[] = [];
    const element = {
      textContent: "source",
      classList: { contains: () => false, add: vi.fn() },
      closest: (selector: string) =>
        embedded && selector === ".markdown-embed" ? {} : null,
      querySelector: () => null,
      createDiv: ({ cls }: { cls: string }) => {
        created.push(cls);
        return { cls };
      },
    };
    const plugin = {
      app: {
        vault: {
          getAbstractFileByPath: () => file("A.md"),
          cachedRead: vi.fn(async () => saved),
        },
      },
    } as unknown as Plugin;
    const context = {
      sourcePath: "A.md",
      getSectionInfo: () => section,
      addChild: vi.fn(),
    } as unknown as MarkdownPostProcessorContext;
    const index = new BlockIndex(plugin.app, () => DEFAULT_BLOCK_DEFINITIONS);
    const done = processReadingModeBlocks(
      plugin,
      index,
      element as unknown as HTMLElement,
      context,
    );
    return { done, element, created };
  }

  function renderedBlocks() {
    return vi.mocked(renderBlock).mock.calls.map(
      ([, block]) => `${block.type} ${block.number}`,
    );
  }

  function renderedMarkdown() {
    return renderMarkdown.mock.calls.map((call: unknown[]) => call[1]);
  }

  it("renders the note's own text with its unsaved edits", async () => {
    const text = `::: lemma\nnew\n:::\n\n${saved}`;
    const { done, element } = render({ text, lineStart: 4, lineEnd: 6 }, false);
    await done;
    expect(element.textContent).toBe("");
    expect(renderedBlocks()).toEqual(["definition 2"]);
  });

  it("restores a split block from its tail in a hover preview", async () => {
    const { done } = render({ text: "after\n::: ^b", lineStart: 0, lineEnd: 1 }, true);
    await done;
    expect(renderedBlocks()).toEqual(["theorem 2"]);
    expect(renderedMarkdown()).toEqual([]);
  });

  it("numbers a heading embed from the saved note", async () => {
    const text = saved.slice(saved.indexOf("# B"));
    const { done } = render({ text, lineStart: 2, lineEnd: 3 }, true);
    await done;
    expect(renderedBlocks()).toEqual(["theorem 2"]);
  });

  it("keeps the text that follows a block in the same section", async () => {
    const text = "::: note\nabc\n:::\nafter";
    const { done } = render({ text, lineStart: 0, lineEnd: 3 }, false);
    await done;
    expect(renderedBlocks()).toEqual(["note null"]);
    expect(renderedMarkdown()).toEqual(["\nafter"]);
  });

  it("empties a section that an earlier block covers", async () => {
    const { done, element, created } = render({ text: saved, lineStart: 8, lineEnd: 10 }, false);
    await done;
    expect(element.textContent).toBe("");
    expect(created).toEqual([]);
    expect(renderBlock).not.toHaveBeenCalled();
  });

  it("rejects an embed whose text is missing from the saved note", async () => {
    const text = "::: lemma\nxyz\n:::";
    const { done } = render({ text, lineStart: 0, lineEnd: 2 }, true);
    await expect(done).rejects.toThrow();
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
    suggest.selectSuggestion({ file: current, block: parse(markdown)[0]! }, {} as KeyboardEvent);
    await vi.waitFor(() => expect(source.transaction).toHaveBeenCalledTimes(1));
    expect(vault.process).not.toHaveBeenCalled();
    expect(source.api.getValue()).toBe("[[#^a|Theorem 1 (A)]]\n\n::: theorem:A\nabc\n::: ^a");
  });

  it("rejects a reference to a target removed after completion", async () => {
    const old = "\\ref\n\n::: theorem:A\nabc\n::: ^a";
    const { current, source, suggest } = setup("\\ref");
    suggest.selectSuggestion({ file: current, block: parse(old)[0]! }, {} as KeyboardEvent);
    await vi.waitFor(() => expect(Notice).toHaveBeenCalled());
    expect(source.api.getValue()).toBe("\\ref");
  });

  it("keeps local edit positions correct when the ID comes before the query", async () => {
    const markdown = "::: theorem:A\nabc\n:::\n\n\\ref";
    const { current, source, suggest } = setup(markdown);
    suggest.context!.start = { line: 4, ch: 0 };
    suggest.context!.end = { line: 4, ch: 4 };
    suggest.selectSuggestion({ file: current, block: parse(markdown)[0]! }, {} as KeyboardEvent);
    await vi.waitFor(() => expect(source.transaction).toHaveBeenCalledTimes(1));
    expect(source.api.getValue()).toBe("::: theorem:A\nabc\n::: ^a\n\n[[#^a|Theorem 1 (A)]]");
  });

  it("uses an atomic vault update for a new cross-file ID", async () => {
    const markdown = "::: theorem:B\nabc\n:::";
    const { source, vault, suggest } = setup("\\ref", markdown);
    suggest.selectSuggestion({ file: file("B.md"), block: parse(markdown)[0]! }, {} as KeyboardEvent);
    await vi.waitFor(() => expect(source.transaction).toHaveBeenCalledTimes(1));
    expect(vault.process).toHaveBeenCalledTimes(1);
    expect(await vault.cachedRead()).toBe("::: theorem:B\nabc\n::: ^b");
    expect(source.api.getValue()).toBe("[[B#^b|Theorem 1 (B)]]");
  });

  it("links an existing cross-file ID by reading the target only", async () => {
    const markdown = "::: theorem:B\nabc\n::: ^b";
    const { source, vault, suggest } = setup("\\ref", markdown);
    suggest.selectSuggestion({ file: file("B.md"), block: parse(markdown)[0]! }, {} as KeyboardEvent);
    await vi.waitFor(() => expect(source.transaction).toHaveBeenCalledTimes(1));
    expect(vault.process).not.toHaveBeenCalled();
    expect(source.api.getValue()).toBe("[[B#^b|Theorem 1 (B)]]");
  });

  it("preserves user edits made while a cross-file target is loading", async () => {
    const markdown = "::: theorem:B\nabc\n::: ^b";
    const pending = deferred<string>();
    const { source, vault, suggest } = setup("\\ref", markdown);
    vault.cachedRead.mockReturnValueOnce(pending.promise);
    suggest.selectSuggestion({ file: file("B.md"), block: parse(markdown)[0]! }, {} as KeyboardEvent);
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
    const parseSpy = vi.spyOn(parser, "parseBlocks");
    let { state } = setup();
    expect(parseSpy).toHaveBeenCalledTimes(1);
    state = state.update({ selection: { anchor: 1 } }).state;
    expect(parseSpy).toHaveBeenCalledTimes(1);
    state = state.update({ changes: { from: 0, insert: "x" } }).state;
    expect(parseSpy).toHaveBeenCalledTimes(2);
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

  it("keeps a widget's DOM when edits above move the block", () => {
    const { state } = setup();
    const before = widgets(state)[0]!;
    const after = widgets(state.update({ changes: { from: 0, insert: "x" } }).state)[0]!;
    expect(before.eq(after)).toBe(true);
  });

  it("places the cursor from the widget's current position", () => {
    const plugin = { addChild: vi.fn(), removeChild: vi.fn() };
    const { state } = setup(plugin as unknown as Plugin);
    const container = { addEventListener: vi.fn() };
    const view = {
      dom: { win: { createDiv: () => container } },
      posAtDOM: () => 7,
      dispatch: vi.fn(),
      focus: vi.fn(),
    };
    const widget = widgets(state)[0]!;
    const dom = widget.toDOM(view as unknown as EditorView);
    const listener = container.addEventListener.mock.calls[0]![1] as (event: MouseEvent) => void;
    listener({ button: 0, targetNode: null, preventDefault: vi.fn() } as unknown as MouseEvent);
    expect(view.dispatch).toHaveBeenCalledWith({
      selection: { anchor: 7 + "::: theorem:B\n".length },
      scrollIntoView: true,
    });
    widget.destroy(dom);
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
