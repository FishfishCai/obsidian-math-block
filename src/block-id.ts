import type { ParsedBlock } from "./parser";

const blockIdPattern = /\^([A-Za-z0-9-]+)\s*$/gmu;

function randomSuffix(): string {
  return crypto.randomUUID().slice(0, 6);
}

function labelStem(block: ParsedBlock): string | null {
  const label = block.label
    ?.normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "");
  return label || null;
}

export function collectBlockIds(markdown: string): Set<string> {
  return new Set(
    Array.from(markdown.matchAll(blockIdPattern), (match) => match[1])
      .filter((id): id is string => id !== undefined),
  );
}

export function createUniqueBlockId(
  block: ParsedBlock,
  usedIds: ReadonlySet<string>,
  suffix: () => string = randomSuffix,
): string {
  const stem = labelStem(block);
  if (stem) {
    if (!usedIds.has(stem)) {
      return stem;
    }
    for (let index = 2; ; index += 1) {
      const candidate = `${stem}-${index}`;
      if (!usedIds.has(candidate)) {
        return candidate;
      }
    }
  }

  for (;;) {
    const candidate = `${block.type}-${suffix()}`;
    if (!usedIds.has(candidate)) {
      return candidate;
    }
  }
}

export function addBlockId(
  markdown: string,
  selectedBlock: ParsedBlock,
  id: string,
): string {
  if (selectedBlock.id) {
    return markdown;
  }
  return `${markdown.slice(0, selectedBlock.to)} ^${id}${markdown.slice(selectedBlock.to)}`;
}
