import {
  DEFAULT_BLOCK_DEFINITIONS,
  type BlockDefinition,
} from "./settings-model";

export interface ParsedBlock {
  type: string;
  label: string | null;
  id: string | null;
  number: number | null;
  body: string;
  raw: string;
  from: number;
  to: number;
  fromLine: number;
  toLine: number;
}

const openingPattern = /^ {0,3}:::\s+([a-zA-Z][a-zA-Z0-9-]*)(?::(.*))?\s*$/;
const closingPattern = /^ {0,3}:{3,}(?:\s+\^([A-Za-z0-9-]+))?\s*$/;
const fencePattern = /^ {0,3}(`{3,}|~{3,})(.*)$/;

interface OpenBlock {
  definition: BlockDefinition;
  label: string | null;
  from: number;
  fromLine: number;
  bodyFrom: number;
}

export function parseBlocks(
  markdown: string,
  definitions: readonly BlockDefinition[] = DEFAULT_BLOCK_DEFINITIONS,
): ParsedBlock[] {
  const lines = markdown.split("\n");
  const types = new Map(
    definitions.map((definition) => [definition.type, definition]),
  );
  const blocks: ParsedBlock[] = [];
  let numberedCounter = 0;
  let offset = 0;
  let open: OpenBlock | null = null;
  let fence: string | null = null;

  for (const [lineIndex, rawLine] of lines.entries()) {
    const from = offset;
    offset += rawLine.length + 1;
    const line = rawLine.replace(/\r$/u, "");
    const codeFence = line.match(fencePattern);
    const marker = codeFence?.[1];
    const info = codeFence?.[2] ?? "";

    if (fence) {
      if (
        marker && marker[0] === fence[0] &&
        marker.length >= fence.length && !info.trim()
      ) {
        fence = null;
      }
      continue;
    }
    if (marker && (marker[0] !== "`" || !info.includes("`"))) {
      fence = marker;
      continue;
    }

    if (open) {
      const closing = line.match(closingPattern);
      if (!closing) {
        continue;
      }
      const number = open.definition.numbered ? ++numberedCounter : null;
      const to = from + line.length;
      blocks.push({
        type: open.definition.type,
        label: open.label,
        id: closing[1] ?? null,
        number,
        body: markdown.slice(open.bodyFrom, from).replace(/\r?\n$/u, ""),
        raw: markdown.slice(open.from, to),
        from: open.from,
        to,
        fromLine: open.fromLine,
        toLine: lineIndex,
      });
      open = null;
      continue;
    }

    const opening = line.match(openingPattern);
    const type = opening?.[1]?.toLowerCase();
    const definition = type ? types.get(type) : undefined;
    if (definition) {
      open = {
        definition,
        label: opening?.[2]?.trim() || null,
        from,
        fromLine: lineIndex,
        bodyFrom: offset,
      };
    }
  }

  return blocks;
}
