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

export function markdownForLineRange(
  markdown: string,
  lineStart: number,
  lineEnd: number,
): string {
  return markdown.split("\n").slice(lineStart, lineEnd + 1).join("\n");
}

export function blockAwareLineRange(
  lineStart: number,
  lineEnd: number,
  blocks: readonly ParsedBlock[],
): BlockAwareLineRange {
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

  const effectiveEnd = blocks
    .filter(
      (block) =>
        block.fromLine >= effectiveStart && block.fromLine <= lineEnd,
    )
    .reduce((end, block) => Math.max(end, block.toLine), lineEnd);

  return {
    lineStart: effectiveStart,
    lineEnd: effectiveEnd,
    fullyCovered: false,
  };
}
