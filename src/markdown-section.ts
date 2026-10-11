import type { ParsedBlock } from "./parser";

const closingIdPattern = /^ {0,3}:{3,}\s+\^([A-Za-z0-9-]+)\s*$/u;

export function previewBlockForSection(
  markdown: string,
  lineStart: number,
  lineEnd: number,
  blocks: readonly ParsedBlock[],
): ParsedBlock | null {
  const sectionId = markdown.trim().match(closingIdPattern)?.[1];
  if (sectionId) {
    return blocks.find((block) => block.id === sectionId) ?? null;
  }
  if (lineStart !== lineEnd) {
    return null;
  }
  return blocks.find(
    (block) => block.id !== null && block.toLine === lineStart,
  ) ?? null;
}

interface BlockAwareLineRange {
  lineStart: number;
  lineEnd: number;
  fullyCovered: boolean;
}

// Section embeds render a slice of the saved note, and their lines count from it.
export function savedLineOffset(text: string, markdown: string): number | null {
  const fragment = text.trimEnd();
  const index = markdown.indexOf(fragment);
  if (index < 0) {
    return null;
  }
  if (markdown.indexOf(fragment, index + 1) >= 0) {
    throw new Error("The rendered text matches more than one place in the note.");
  }
  return markdown.slice(0, index).split("\n").length - 1;
}

export function offsetOfLine(markdown: string, line: number): number {
  let offset = 0;
  for (let index = 0; index < line; index += 1) {
    offset = markdown.indexOf("\n", offset) + 1;
  }
  return offset;
}

export function markdownForLineRange(
  markdown: string,
  lineStart: number,
  lineEnd: number,
): string {
  return markdown.split("\n").slice(lineStart, lineEnd + 1).join("\n");
}

// A null range marks a section of ordinary Markdown.
export function blockAwareLineRange(
  lineStart: number,
  lineEnd: number,
  blocks: readonly ParsedBlock[],
): BlockAwareLineRange | null {
  const continuedBlocks = blocks.filter(
    (block) => block.fromLine < lineStart && block.toLine >= lineStart,
  );
  const effectiveStart = continuedBlocks.reduce(
    (start, block) => Math.max(start, block.toLine + 1),
    lineStart,
  );

  if (effectiveStart > lineEnd) {
    return {
      lineStart: effectiveStart,
      lineEnd,
      fullyCovered: true,
    };
  }

  const startedBlocks = blocks.filter(
    (block) => block.fromLine >= effectiveStart && block.fromLine <= lineEnd,
  );
  if (continuedBlocks.length === 0 && startedBlocks.length === 0) {
    return null;
  }

  return {
    lineStart: effectiveStart,
    lineEnd: startedBlocks.reduce(
      (end, block) => Math.max(end, block.toLine),
      lineEnd,
    ),
    fullyCovered: false,
  };
}
