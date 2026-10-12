import {
  MarkdownRenderChild,
  MarkdownRenderer,
  TFile,
  type MarkdownPostProcessorContext,
  type MarkdownSectionInformation,
  type Plugin,
} from "obsidian";

import type { BlockIndex, IndexedDocument } from "./block-index";
import {
  blockAwareLineRange,
  previewBlockForSection,
  type BlockAwareLineRange,
} from "./markdown-section";
import { renderBlock } from "./render";

interface DocumentRange extends BlockAwareLineRange {
  document: IndexedDocument;
}

async function renderPlainMarkdown(
  plugin: Plugin,
  markdown: string,
  container: HTMLElement,
  sourcePath: string,
  component: MarkdownRenderChild,
): Promise<void> {
  if (!markdown.trim()) {
    return;
  }

  const plainContainer = container.createDiv({ cls: "math-block-generated" });
  await MarkdownRenderer.render(
    plugin.app,
    markdown,
    plainContainer,
    sourcePath,
    component,
  );
}

function withDocument(
  range: BlockAwareLineRange | null,
  document: IndexedDocument,
): DocumentRange | null {
  return range && { ...range, document };
}

// Obsidian post-processes a section before attaching it, so the rendered text
// tells the cases apart. A block link previews the tail of a block, embeds and
// hover previews render the saved note or a slice of it, and any other text is
// its own document: a view with unsaved edits or a canvas card.
async function sectionRange(
  plugin: Plugin,
  index: BlockIndex,
  sourcePath: string,
  section: MarkdownSectionInformation,
): Promise<DocumentRange | null> {
  const file = plugin.app.vault.getAbstractFileByPath(sourcePath);
  if (file instanceof TFile && file.extension === "md") {
    const note = await index.getDocument(file);
    const target = previewBlockForSection(section.text, note.blocks);
    if (target) {
      return {
        document: note,
        lineStart: target.fromLine,
        lineEnd: target.toLine,
        fullyCovered: false,
      };
    }
    const line = index.sliceLine(section.text, note);
    if (line !== null) {
      return withDocument(
        blockAwareLineRange(
          section.lineStart + line,
          section.lineEnd + line,
          note.blocks,
        ),
        note,
      );
    }
  }

  const document = index.parseText(section.text);
  return withDocument(
    blockAwareLineRange(section.lineStart, section.lineEnd, document.blocks),
    document,
  );
}

export async function processReadingModeBlocks(
  plugin: Plugin,
  index: BlockIndex,
  element: HTMLElement,
  context: MarkdownPostProcessorContext,
): Promise<void> {
  if (
    element.closest(".math-block-generated") ||
    (
      element.classList.contains("math-block-reading-section") &&
      element.querySelector(".math-block-generated") !== null
    )
  ) {
    return;
  }

  const section = context.getSectionInfo(element);
  if (!section) {
    return;
  }
  const range = await sectionRange(
    plugin,
    index,
    context.sourcePath,
    section,
  );
  if (!range) {
    return;
  }
  element.textContent = "";
  element.classList.add("math-block-reading-section");
  if (range.fullyCovered) {
    return;
  }

  const { document } = range;
  const { from, to } = document.lineRange(range.lineStart, range.lineEnd);
  const renderChild = new MarkdownRenderChild(element);
  context.addChild(renderChild);
  // Each render creates its container before it awaits, keeping source order.
  const renders: Promise<void>[] = [];
  let cursor = from;
  for (const block of document.blocks) {
    if (block.fromLine > range.lineEnd) {
      break;
    }
    if (block.fromLine < range.lineStart) {
      continue;
    }
    renders.push(renderPlainMarkdown(
      plugin,
      document.markdown.slice(cursor, block.from),
      element,
      context.sourcePath,
      renderChild,
    ));
    renders.push(renderBlock(
      plugin.app,
      block,
      element.createDiv({ cls: "math-block-generated" }),
      context.sourcePath,
      renderChild,
    ));
    cursor = block.to;
  }
  renders.push(renderPlainMarkdown(
    plugin,
    document.markdown.slice(cursor, to),
    element,
    context.sourcePath,
    renderChild,
  ));
  await Promise.all(renders);
}
