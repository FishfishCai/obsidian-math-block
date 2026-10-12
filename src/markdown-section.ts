import type { ParsedBlock } from "./parser";

const closingIdPattern = /^ {0,3}:{3,}\s+\^([A-Za-z0-9-]+)\s*$/u;

// A block link renders only the Markdown section that holds the block ID.
// Display math splits a block, so that section is the tail after the last
// split. A preview of the whole block renders through the section path.
export function previewBlockForSection(
  markdown: string,
  blocks: readonly ParsedBlock[],
): ParsedBlock | null {
  const text = markdown.trim();
  const lastLine = text.slice(text.lastIndexOf("\n") + 1);
  const sectionId = lastLine.match(closingIdPattern)?.[1];
  const block = sectionId
    ? blocks.find((candidate) => candidate.id === sectionId)
    : undefined;
  const raw = block?.raw.trimEnd();
  if (!block || !raw?.endsWith(text)) {
    return null;
  }
  const head = raw.slice(0, raw.length - text.length);
  return /\n[ \t]*$/u.test(head) ? block : null;
}

export interface BlockAwareLineRange {
  lineStart: number;
  lineEnd: number;
  fullyCovered: boolean;
}

// Section embeds render a slice of the saved note, and their lines count from
// it. A null offset marks text of its own, such as a view with unsaved edits.
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

export function lineStarts(markdown: string): number[] {
  const starts = [0];
  for (
    let index = markdown.indexOf("\n");
    index >= 0;
    index = markdown.indexOf("\n", index + 1)
  ) {
    starts.push(index + 1);
  }
  return starts;
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
