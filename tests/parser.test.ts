import { describe, expect, it } from "vitest";

import { parseBlocks } from "../src/parser";
import { DEFAULT_BLOCK_DEFINITIONS } from "../src/settings-model";

function firstBlock(markdown: string) {
  const block = parseBlocks(markdown)[0];
  if (!block) {
    throw new Error("Expected one parsed block.");
  }
  return block;
}

describe("parseBlocks", () => {
  it("keeps unfinished blocks as source", () => {
    expect(parseBlocks("::: theorem\n".repeat(1_000))).toEqual([]);
  });

  it("uses one shared counter for the six numbered types", () => {
    const markdown = [
      "::: definition:Vector space",
      "A definition.",
      ":::",
      "",
      "::: note",
      "A note.",
      ":::",
      "",
      "::: theorem:Basis theorem",
      "A theorem.",
      ":::",
    ].join("\n");

    const blocks = parseBlocks(markdown);
    expect(blocks.map((block) => block.number)).toEqual([1, null, 2]);
    expect(blocks.map((block) => block.label)).toEqual([
      "Vector space",
      null,
      "Basis theorem",
    ]);
    expect(blocks.map((block) => block.id)).toEqual([null, null, null]);
  });

  it("ignores block-looking text inside fenced code", () => {
    const markdown = [
      "```markdown",
      "::: theorem:Not a block",
      "body",
      ":::",
      "```",
      "::: proposition:Actual",
      "body",
      ":::",
    ].join("\n");

    const blocks = parseBlocks(markdown);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]?.label).toBe("Actual");
  });

  it("does not close a block on colons inside its code fence", () => {
    const markdown = [
      "::: example:Code",
      "```",
      ":::",
      "```",
      "Still in the block.",
      ":::",
    ].join("\n");

    const block = firstBlock(markdown);
    expect(block.toLine).toBe(5);
    expect(block.body).toContain("Still in the block.");
  });

  it("keeps an indented closing fence inside its code block", () => {
    expect(parseBlocks([
      "```",
      "    ```",
      "::: theorem",
      "abc",
      ":::",
      "```",
    ].join("\n"))).toEqual([]);
  });

  it("accepts a block after inline backticks on their own line", () => {
    expect(parseBlocks([
      "``` abc ```",
      "::: theorem",
      "abc",
      ":::",
    ].join("\n"))).toHaveLength(1);
  });

  it("keeps CRLF offsets without including the final carriage return", () => {
    const markdown = "before\r\n::: theorem\r\nabc\r\n:::  \r\nafter";
    const block = firstBlock(markdown);
    expect(block.body).toBe("abc");
    expect(markdown.slice(block.from, block.to)).toBe(block.raw);
    expect(markdown.slice(block.to)).toBe("\r\nafter");
  });

  it("supports every default block type", () => {
    const markdown = DEFAULT_BLOCK_DEFINITIONS.map((definition) => [
      `::: ${definition.type}:${definition.type}`,
      "body",
      "::::",
    ].join("\n")).join("\n");

    expect(parseBlocks(markdown).map((block) => block.type)).toEqual(
      DEFAULT_BLOCK_DEFINITIONS.map((definition) => definition.type),
    );
  });

  it("parses custom types and follows their numbering settings", () => {
    const definitions = [
      {
        type: "axiom",
        title: { family: "serif", style: "bold" },
        body: { family: "serif", style: "roman" },
        numbered: true,
      },
      {
        type: "aside",
        title: { family: "sans-serif", style: "italic" },
        body: { family: "monospace", style: "roman" },
        numbered: false,
      },
    ] as const;
    const blocks = parseBlocks([
      "::: axiom:Choice",
      "An axiom.",
      ":::",
      "::: aside",
      "An aside.",
      ":::",
    ].join("\n"), definitions);

    expect(blocks.map((block) => block.type)).toEqual(["axiom", "aside"]);
    expect(blocks.map((block) => block.number)).toEqual([1, null]);
  });

  it("keeps inline math intact in labels", () => {
    const block = firstBlock([
      "::: theorem:$f: X \\to Y$",
      "body",
      ":::",
    ].join("\n"));

    expect(block.label).toBe("$f: X \\to Y$");
  });

  it("reads an Obsidian block ID from the closing fence", () => {
    const block = firstBlock([
      "::: theorem:Spectral theorem",
      "body",
      "::: ^spectral-theorem-2A",
    ].join("\n"));

    expect(block.id).toBe("spectral-theorem-2A");
    expect(block.raw).toContain("::: ^spectral-theorem-2A");
    expect(block.body).toBe("body");
  });

  it("does not accept characters outside Obsidian's block ID syntax", () => {
    expect(parseBlocks([
      "::: theorem:Invalid ID",
      "body",
      "::: ^not_valid",
    ].join("\n"))).toEqual([]);
  });
});
