import {
  MarkdownRenderChild,
  MarkdownRenderer,
  TFile,
  type MarkdownPostProcessorContext,
  type Plugin,
} from "obsidian";

import type { BlockIndex } from "./block-index";
import {
  blockAwareLineRange,
  markdownForLineRange,
  offsetOfLine,
  previewBlockForSection,
  savedLineOffset,
} from "./markdown-section";
import { renderBlock } from "./render";

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
  const file = plugin.app.vault.getAbstractFileByPath(context.sourcePath);
  if (!(file instanceof TFile)) {
    return;
  }
  const source = await index.getDocument(file);
  const hoverPopover = element.closest<HTMLElement>(".hover-popover");
  const exactPreview = hoverPopover !== null ||
    element.closest(".internal-embed") !== null;
  if (exactPreview) {
    const targetBlock = previewBlockForSection(
      section.text,
      section.lineStart,
      section.lineEnd,
      source.blocks,
    );
    if (targetBlock) {
      element.textContent = "";
      element.classList.add("math-block-reading-section");
      if (hoverPopover) {
        const targetSection = element.closest<HTMLElement>(
          ".markdown-preview-section",
        ) ?? element;
        targetSection.classList.add("math-block-hover-target");
        hoverPopover.classList.add("math-block-hover-popover");
      }
      const renderChild = new MarkdownRenderChild(element);
      context.addChild(renderChild);
      const blockContainer = element.createDiv({
        cls: "math-block-generated",
      });
      await renderBlock(
        plugin.app,
        targetBlock,
        blockContainer,
        context.sourcePath,
        renderChild,
      );
      return;
    }
  }

  // Section embeds render a slice of the saved note. The note's own view and
  // whole-note embeds render its full text, which may hold unsaved edits.
  let markdown = source.markdown;
  let blocks = source.blocks;
  let lineOffset = 0;
  if (section.text.trimEnd() !== source.markdown.trimEnd()) {
    const textBlocks = index.parseText(section.text);
    if (textBlocks.length === 0) {
      return;
    }
    const savedOffset = savedLineOffset(section.text, source.markdown);
    if (savedOffset === null) {
      markdown = section.text;
      blocks = textBlocks;
    } else {
      lineOffset = savedOffset;
    }
  }
  const range = blockAwareLineRange(
    section.lineStart + lineOffset,
    section.lineEnd + lineOffset,
    blocks,
  );
  if (!range) {
    return;
  }
  element.textContent = "";
  element.classList.add("math-block-reading-section");
  if (range.fullyCovered) {
    return;
  }

  const sectionFrom = offsetOfLine(markdown, range.lineStart);
  const sectionMarkdown = markdownForLineRange(
    markdown,
    range.lineStart,
    range.lineEnd,
  );
  const renderChild = new MarkdownRenderChild(element);
  context.addChild(renderChild);
  let cursor = 0;

  for (const block of blocks) {
    if (block.fromLine < range.lineStart || block.fromLine > range.lineEnd) {
      continue;
    }
    await renderPlainMarkdown(
      plugin,
      sectionMarkdown.slice(cursor, block.from - sectionFrom),
      element,
      context.sourcePath,
      renderChild,
    );
    const blockContainer = element.createDiv({
      cls: "math-block-generated",
    });
    await renderBlock(
      plugin.app,
      block,
      blockContainer,
      context.sourcePath,
      renderChild,
    );
    cursor = block.to - sectionFrom;
  }

  await renderPlainMarkdown(
    plugin,
    sectionMarkdown.slice(cursor),
    element,
    context.sourcePath,
    renderChild,
  );
}
