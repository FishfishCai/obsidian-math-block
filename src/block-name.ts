import type { ParsedBlock } from "./parser";

export function displayNameForType(type: string): string {
  return type
    .split("-")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export function blockDisplayName(block: ParsedBlock): string {
  let name = displayNameForType(block.type);
  if (block.number !== null) {
    name += ` ${block.number}`;
  }
  if (block.label) {
    name += ` (${block.label})`;
  }
  return name;
}

export function blockBodyPreview(block: ParsedBlock): string {
  return block.body
    .replace(/\s+/gu, " ")
    .trim()
    .slice(0, 100);
}
