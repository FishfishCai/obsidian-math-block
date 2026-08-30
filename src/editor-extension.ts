import {
  Prec,
  StateField,
  type EditorState,
  type Extension,
} from "@codemirror/state";
import {
  Decoration,
  type DecorationSet,
  EditorView,
  WidgetType,
} from "@codemirror/view";
import {
  editorInfoField,
  editorLivePreviewField,
  MarkdownRenderChild,
  type Plugin,
} from "obsidian";

import { parseBlocks, type ParsedBlock } from "./parser";
import { renderBlock } from "./render";
import {
  definitionForType,
  type BlockDefinition,
} from "./settings-model";

function caretAtPoint(
  element: HTMLElement,
  x: number,
  y: number,
): CaretPosition | null {
  const document = element.ownerDocument;
  const caret = document.caretPositionFromPoint(x, y);
  if (!caret || !element.contains(caret.offsetNode)) {
    return null;
  }

  return caret;
}

function textRatioAtCaret(
  element: HTMLElement,
  caret: CaretPosition,
): number {
  const document = element.ownerDocument;

  const prefix = document.createRange();
  prefix.setStart(element, 0);
  prefix.setEnd(caret.offsetNode, caret.offset);
  const content = document.createRange();
  content.selectNodeContents(element);
  const length = content.toString().length;
  return length === 0 ? 0 : prefix.toString().length / length;
}

function nearestOccurrence(
  source: string,
  text: string,
  textOffset: number,
  expected: number,
): number | null {
  if (!text) {
    return null;
  }

  let best: number | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (let index = source.indexOf(text); index >= 0; index = source.indexOf(text, index + 1)) {
    const candidate = index + textOffset;
    const distance = Math.abs(candidate - expected);
    if (distance < bestDistance) {
      best = candidate;
      bestDistance = distance;
    }
  }
  return best;
}

function normalizedText(value: string): { text: string; offsets: number[] } {
  let text = "";
  const offsets: number[] = [];
  let afterWhitespace = false;

  for (let index = 0; index < value.length; index += 1) {
    const character = value.charAt(index);
    if (/\s/u.test(character)) {
      if (!afterWhitespace) {
        text += " ";
        offsets.push(index);
      }
      afterWhitespace = true;
      continue;
    }

    text += character;
    offsets.push(index);
    afterWhitespace = false;
  }

  return { text, offsets };
}

function sourceOffsetForTextNode(
  source: string,
  node: Node,
  offset: number,
  expected: number,
): number | null {
  if (node.nodeType !== Node.TEXT_NODE || node.nodeValue === null) {
    return null;
  }

  const nodeText = node.nodeValue;
  const textOffset = Math.min(Math.max(offset, 0), nodeText.length);
  const exact = nearestOccurrence(source, nodeText, textOffset, expected);
  if (exact !== null) {
    return exact;
  }

  const normalizedSource = normalizedText(source);
  const normalizedNode = normalizedText(nodeText);
  const normalizedOffset = normalizedText(nodeText.slice(0, textOffset)).text.length;
  const normalizedMatch = nearestOccurrence(
    normalizedSource.text,
    normalizedNode.text,
    normalizedOffset,
    normalizedText(source.slice(0, expected)).text.length,
  );
  if (normalizedMatch === null) {
    return null;
  }

  return normalizedMatch >= normalizedSource.offsets.length
    ? source.length
    : (normalizedSource.offsets[normalizedMatch] ?? null);
}

function sourcePositionAtPoint(
  block: ParsedBlock,
  container: HTMLElement,
  event: MouseEvent,
): number {
  const openingLine = block.raw.split("\n", 1)[0] ?? "";
  const bodyStart = Math.min(
    block.from + openingLine.length + 1,
    block.to,
  );
  const target = event.targetNode;
  const section = target?.instanceOf(Element)
    ? target.closest<HTMLElement>(".math-block-title, .math-block-body")
    : null;
  if (!section || !container.contains(section)) {
    return bodyStart;
  }

  const title = section.classList.contains("math-block-title");
  const source = title ? openingLine : block.body;
  const start = title ? block.from : bodyStart;
  const caret = caretAtPoint(section, event.clientX, event.clientY);
  if (!caret) {
    return start;
  }

  const expected = Math.round(source.length * textRatioAtCaret(section, caret));
  const precise = sourceOffsetForTextNode(
    source,
    caret.offsetNode,
    caret.offset,
    expected,
  );
  return start + (precise ?? expected);
}

// CodeMirror can reuse DOM across different widget instances.
const renderChildren = new WeakMap<HTMLElement, MarkdownRenderChild>();

class BlockWidget extends WidgetType {
  private readonly definitionKey: string;

  constructor(
    private readonly plugin: Plugin,
    private readonly block: ParsedBlock,
    private readonly definition: BlockDefinition,
    private readonly sourcePath: string,
  ) {
    super();
    this.definitionKey = JSON.stringify(definition);
  }

  eq(other: BlockWidget): boolean {
    return (
      other.block.raw === this.block.raw &&
      other.block.number === this.block.number &&
      other.block.from === this.block.from &&
      other.sourcePath === this.sourcePath &&
      other.definitionKey === this.definitionKey
    );
  }

  toDOM(view: EditorView): HTMLElement {
    const ownerWindow = view.dom.win as Window & { createDiv: typeof createDiv };
    const container = ownerWindow.createDiv({
      cls: "math-block-editor-widget math-block-generated",
    });

    const renderChild = new MarkdownRenderChild(container);
    this.plugin.addChild(renderChild);
    renderChildren.set(container, renderChild);
    void renderBlock(
      this.plugin.app,
      this.block,
      container,
      this.sourcePath,
      renderChild,
      this.definition,
    );

    container.addEventListener("mousedown", (event) => {
      const target = event.targetNode;
      if (event.button !== 0 || (target?.instanceOf(Element) && target.closest("a"))) {
        return;
      }

      event.preventDefault();
      const anchor = sourcePositionAtPoint(this.block, container, event);
      view.dispatch({
        selection: { anchor },
        scrollIntoView: true,
      });
      view.focus();
    });

    return container;
  }

  destroy(dom: HTMLElement): void {
    const renderChild = renderChildren.get(dom);
    if (renderChild) {
      this.plugin.removeChild(renderChild);
      renderChildren.delete(dom);
    }
  }
}

function selectionTouchesRange(
  state: EditorState,
  range: Pick<ParsedBlock, "from" | "to">,
): boolean {
  return state.selection.ranges.some(
    (selection) => selection.from <= range.to && selection.to >= range.from,
  );
}

function buildDecorations(
  plugin: Plugin,
  state: EditorState,
  blocks: readonly ParsedBlock[],
  definitions: readonly BlockDefinition[],
): DecorationSet {
  if (!state.field(editorLivePreviewField)) {
    return Decoration.none;
  }

  const sourcePath = state.field(editorInfoField).file?.path ?? "";
  const hiddenBlocks = blocks
    .filter((block) => !selectionTouchesRange(state, block))
    .flatMap((block) => {
      const definition = definitionForType(definitions, block.type);
      return definition
        ? [Decoration.replace({
          block: true,
          widget: new BlockWidget(plugin, block, definition, sourcePath),
        }).range(block.from, block.to)]
        : [];
    });

  return Decoration.set(hiddenBlocks);
}

export function createBlockEditorExtension(
  plugin: Plugin,
  getDefinitions: () => readonly BlockDefinition[],
): Extension {
  const blockField = StateField.define<{
    definitions: readonly BlockDefinition[];
    blocks: ParsedBlock[];
    decorations: DecorationSet;
  }>({
    create(state) {
      const definitions = getDefinitions();
      const blocks = parseBlocks(state.doc.toString(), definitions);
      return {
        definitions,
        blocks,
        decorations: buildDecorations(plugin, state, blocks, definitions),
      };
    },
    update(value, transaction) {
      const definitions = getDefinitions();
      const blocks = transaction.docChanged || definitions !== value.definitions
        ? parseBlocks(transaction.state.doc.toString(), definitions)
        : value.blocks;
      return {
        definitions,
        blocks,
        decorations: buildDecorations(plugin, transaction.state, blocks, definitions),
      };
    },
    provide(field) {
      return EditorView.decorations.from(field, (value) => value.decorations);
    },
  });

  return Prec.highest(blockField);
}
