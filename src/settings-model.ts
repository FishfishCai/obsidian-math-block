export type FontStyle = "roman" | "bold" | "italic" | "bold-italic";

const fontStyles = new Set<FontStyle>([
  "roman",
  "bold",
  "italic",
  "bold-italic",
]);

function isFontStyle(value: unknown): value is FontStyle {
  return typeof value === "string" && fontStyles.has(value as FontStyle);
}

export interface Typography {
  family: string;
  style: FontStyle;
}

export interface BlockDefinition {
  type: string;
  title: Typography;
  body: Typography;
  numbered: boolean;
}

export interface MathBlockSettings {
  blocks: BlockDefinition[];
}

export const DEFAULT_FONT_FAMILY = "Times New Roman";

export function quoteFontFamily(family: string): string {
  return `"${family.replace(/["\\]/gu, "\\$&")}"`;
}

const defaultTypography = (style: FontStyle): Typography => ({
  family: DEFAULT_FONT_FAMILY,
  style,
});

function definition(
  type: string,
  title: FontStyle,
  body: FontStyle,
  numbered: boolean,
): BlockDefinition {
  return {
    type,
    title: defaultTypography(title),
    body: defaultTypography(body),
    numbered,
  };
}

export const DEFAULT_BLOCK_DEFINITIONS: readonly BlockDefinition[] = [
  definition("definition", "bold", "roman", true),
  definition("theorem", "bold", "italic", true),
  definition("proposition", "bold", "italic", true),
  definition("lemma", "bold", "italic", true),
  definition("corollary", "bold", "italic", true),
  definition("example", "bold", "roman", false),
  definition("note", "bold", "roman", false),
];

export const BLOCK_TYPE_PATTERN = /^[a-z][a-z0-9-]*$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function parseTypography(value: unknown, path: string): Typography {
  if (
    !isRecord(value) ||
    typeof value.family !== "string" ||
    !value.family.trim() ||
    !isFontStyle(value.style)
  ) {
    throw new Error(`${path} needs a font family and a font style.`);
  }
  return { family: value.family.trim(), style: value.style };
}

function parseBlock(value: unknown, index: number): BlockDefinition {
  const path = `blocks[${index}]`;
  if (
    !isRecord(value) ||
    typeof value.type !== "string" ||
    !BLOCK_TYPE_PATTERN.test(value.type) ||
    typeof value.numbered !== "boolean"
  ) {
    throw new Error(`${path} needs a valid name and a numbered flag.`);
  }
  return {
    type: value.type,
    title: parseTypography(value.title, `${path}.title`),
    body: parseTypography(value.body, `${path}.body`),
    numbered: value.numbered,
  };
}

// Obsidian loads null until the plugin first saves its settings.
export function parseSettings(value: unknown): MathBlockSettings {
  if (value === null) {
    return {
      blocks: DEFAULT_BLOCK_DEFINITIONS.map((block) => structuredClone(block)),
    };
  }
  if (!isRecord(value) || !Array.isArray(value.blocks)) {
    throw new Error("Settings need a blocks list.");
  }
  const blocks = value.blocks.map(parseBlock);
  const types = new Set(blocks.map((block) => block.type));
  if (types.size !== blocks.length) {
    throw new Error("Block names must be unique.");
  }
  return { blocks };
}

export function uniqueCustomType(
  definitions: readonly BlockDefinition[],
): string {
  const used = new Set(definitions.map((definition) => definition.type));
  if (!used.has("custom")) {
    return "custom";
  }
  for (let suffix = 2; ; suffix += 1) {
    const candidate = `custom-${suffix}`;
    if (!used.has(candidate)) {
      return candidate;
    }
  }
}
