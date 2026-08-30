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

export const PROOF_TYPE = "proof";
export const DEFAULT_FONT_FAMILY = '"Times New Roman", serif';

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

const PROOF_DEFINITION = definition(PROOF_TYPE, "italic", "roman", false);

export const DEFAULT_BLOCK_DEFINITIONS: readonly BlockDefinition[] = [
  PROOF_DEFINITION,
  definition("definition", "bold", "roman", true),
  definition("theorem", "bold", "italic", true),
  definition("proposition", "bold", "italic", true),
  definition("lemma", "bold", "italic", true),
  definition("corollary", "bold", "italic", true),
  definition("example", "bold", "roman", true),
  definition("note", "bold", "roman", false),
];

export const BLOCK_TYPE_PATTERN = /^[a-z][a-z0-9-]*$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function typography(value: unknown, defaults: Typography): Typography {
  if (!isRecord(value)) {
    return { ...defaults };
  }
  const family = value.family;
  const style = value.style;
  return {
    family: typeof family === "string" && family.trim()
      ? family.trim()
      : defaults.family,
    style: isFontStyle(style)
      ? style
      : defaults.style,
  };
}

function normalizedBlocks(value: unknown): BlockDefinition[] {
  if (!Array.isArray(value)) {
    return DEFAULT_BLOCK_DEFINITIONS.map((block) => structuredClone(block));
  }

  const blocks: BlockDefinition[] = [];
  const usedTypes = new Set<string>();
  for (const candidate of value) {
    if (!isRecord(candidate) || typeof candidate.type !== "string") {
      continue;
    }
    const type = candidate.type.trim().toLowerCase();
    if (!BLOCK_TYPE_PATTERN.test(type) || usedTypes.has(type)) {
      continue;
    }
    const defaultDefinition = DEFAULT_BLOCK_DEFINITIONS.find(
      (block) => block.type === type,
    );
    blocks.push({
      type,
      title: typography(
        candidate.title,
        defaultDefinition?.title ?? defaultTypography("bold"),
      ),
      body: typography(
        candidate.body,
        defaultDefinition?.body ?? defaultTypography("roman"),
      ),
      numbered: type !== PROOF_TYPE && (
        typeof candidate.numbered === "boolean"
          ? candidate.numbered
          : (defaultDefinition?.numbered ?? false)
      ),
    });
    usedTypes.add(type);
  }
  const proof = blocks.find((block) => block.type === PROOF_TYPE) ??
    structuredClone(PROOF_DEFINITION);
  return [proof, ...blocks.filter((block) => block.type !== PROOF_TYPE)];
}

export function normalizeSettings(value: unknown): MathBlockSettings {
  const stored = isRecord(value) ? value : {};
  return {
    blocks: normalizedBlocks(stored.blocks),
  };
}

export function definitionForType(
  definitions: readonly BlockDefinition[],
  type: string,
): BlockDefinition | null {
  return definitions.find((definition) => definition.type === type) ?? null;
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
