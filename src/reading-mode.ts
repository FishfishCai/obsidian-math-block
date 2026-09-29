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
  previewBlockForSection,
} from "./markdown-section";
import { parseBlocks, type ParsedBlock } from "./parser";
import { renderBlock } from "./render";
import type { BlockDefinition } from "./settings-model";

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
  getDefinitions: () => readonly BlockDefinition[],
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

  // Parse section.text only when it is a fragment of the note.
  const definitions = getDefinitions();
  const fragmentBlocks = section.text.trim() === source.markdown.trim()
    ? []
    : parseBlocks(section.text, definitions);

  let sectionMarkdown: string;
  let localBlocks: ParsedBlock[];
  let sectionLineStart: number;
  if (fragmentBlocks.length > 0) {
    sectionMarkdown = section.text;
    localBlocks = fragmentBlocks;
    sectionLineStart = section.lineStart;
  } else {
    const range = blockAwareLineRange(
      section.lineStart,
      section.lineEnd,
      source.blocks,
    );
    if (!range) {
      return;
    }
    if (range.fullyCovered) {
      element.textContent = "";
      element.classList.add("math-block-reading-section");
      return;
    }

    sectionMarkdown = markdownForLineRange(
      source.markdown,
      range.lineStart,
      range.lineEnd,
    );
    localBlocks = parseBlocks(sectionMarkdown, definitions);
    sectionLineStart = range.lineStart;
  }

  element.textContent = "";
  element.classList.add("math-block-reading-section");
  const renderChild = new MarkdownRenderChild(element);
  context.addChild(renderChild);
  let cursor = 0;

  for (const localBlock of localBlocks) {
    await renderPlainMarkdown(
      plugin,
      sectionMarkdown.slice(cursor, localBlock.from),
      element,
      context.sourcePath,
      renderChild,
    );

    const absoluteLine = sectionLineStart + localBlock.fromLine;
    const globalBlock = (
      localBlock.id
        ? source.blocks.find((block) => block.id === localBlock.id)
        : undefined
    ) ?? source.blocks.find((block) => block.fromLine === absoluteLine);
    const blockContainer = element.createDiv({
      cls: "math-block-generated",
    });
    await renderBlock(
      plugin.app,
      globalBlock ? { ...localBlock, number: globalBlock.number } : localBlock,
      blockContainer,
      context.sourcePath,
      renderChild,
    );
    cursor = localBlock.to;
  }

  await renderPlainMarkdown(
    plugin,
    sectionMarkdown.slice(cursor),
    element,
    context.sourcePath,
    renderChild,
  );
}
