import { describe, expect, it } from "vitest";

import {
  addBlockId,
  collectBlockIds,
  createUniqueBlockId,
} from "../src/block-id";
import { blockBodyPreview, blockDisplayName } from "../src/block-name";
import { parseBlocks } from "../src/parser";

function firstBlock(markdown: string) {
  const block = parseBlocks(markdown)[0];
  if (!block) {
    throw new Error("Expected one parsed block.");
  }
  return block;
}

describe("reference names", () => {
  it("uses the same type, number, and label shown by the block", () => {
    const block = firstBlock([
      "::: theorem:Spectral theorem",
      "A symmetric matrix is diagonalizable.",
      ":::",
    ].join("\n"));

    expect(blockDisplayName(block)).toBe("Theorem 1 (Spectral theorem)");
    expect(blockBodyPreview(block)).toBe(
      "A symmetric matrix is diagonalizable.",
    );
  });
});

describe("reference IDs", () => {
  it("creates readable, unique IDs from labels", () => {
    const block = firstBlock([
      "::: example:$f: X \\to Y$",
      "body",
      ":::",
    ].join("\n"));

    expect(createUniqueBlockId(block, new Set())).toBe("f-x-to-y");
    expect(createUniqueBlockId(block, new Set(["f-x-to-y"]))).toBe(
      "f-x-to-y-2",
    );
  });

  it("uses a generated suffix when a label has no Latin ID characters", () => {
    const block = firstBlock([
      "::: theorem:谱定理",
      "body",
      ":::",
    ].join("\n"));

    expect(createUniqueBlockId(block, new Set(), () => "a1b2c3")).toBe(
      "theorem-a1b2c3",
    );
  });

  it("writes the ID on the existing closing fence", () => {
    const markdown = [
      "::: theorem:Spectral theorem",
      "body",
      "::::",
    ].join("\n");
    const block = firstBlock(markdown);

    expect(addBlockId(markdown, block, "spectral-theorem")).toBe([
      "::: theorem:Spectral theorem",
      "body",
      ":::: ^spectral-theorem",
    ].join("\n"));
  });

  it("collects IDs from plugin and ordinary Obsidian blocks", () => {
    const markdown = [
      "Paragraph ^ordinary",
      "",
      "::: theorem",
      "body",
      "::: ^plugin-block",
    ].join("\n");

    expect(collectBlockIds(markdown)).toEqual(
      new Set(["ordinary", "plugin-block"]),
    );
  });

  it("adds an ID without rewriting surrounding text or line endings", () => {
    const markdown = "before\r\n::: theorem\r\nabc\r\n::::  \r\nafter";
    expect(addBlockId(markdown, firstBlock(markdown), "abc")).toBe(
      "before\r\n::: theorem\r\nabc\r\n::::   ^abc\r\nafter",
    );
  });
});
