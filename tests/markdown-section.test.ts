import { describe, expect, it } from "vitest";

import {
  blockAwareLineRange,
  markdownForLineRange,
  offsetOfLine,
  previewBlockForSection,
  savedLineOffset,
} from "../src/markdown-section";
import { parseBlocks } from "../src/parser";
import { DEFAULT_BLOCK_DEFINITIONS } from "../src/settings-model";

function parse(markdown: string) {
  return parseBlocks(markdown, DEFAULT_BLOCK_DEFINITIONS);
}

describe("savedLineOffset", () => {
  const markdown = [
    "# Basics",
    "",
    "::: definition:Rank",
    "body",
    ":::",
    "",
    "# Eigen",
    "",
    "::: lemma",
    "body",
    ":::",
    "",
  ].join("\n");

  it("places the whole note at line zero", () => {
    expect(savedLineOffset(markdown, markdown)).toBe(0);
  });

  it("finds the source line of an embedded section", () => {
    const section = ["# Eigen", "", "::: lemma", "body", ":::", ""].join("\n");
    expect(savedLineOffset(section, markdown)).toBe(6);
  });

  it("returns null for text missing from the saved note", () => {
    expect(savedLineOffset("::: theorem\nother\n:::", markdown)).toBeNull();
  });

  it("rejects text found more than once", () => {
    expect(() => savedLineOffset("body\n:::", markdown)).toThrow();
  });
});

describe("offsetOfLine", () => {
  it("returns the character offset where a line starts", () => {
    const markdown = "ab\ncde\n\nf";
    expect(offsetOfLine(markdown, 0)).toBe(0);
    expect(offsetOfLine(markdown, 1)).toBe(3);
    expect(offsetOfLine(markdown, 3)).toBe(8);
  });
});

describe("markdownForLineRange", () => {
  it("extracts the inclusive Obsidian section range from full-file text", () => {
    const markdown = [
      "# Note",
      "",
      "::: theorem:First",
      "body",
      ":::",
      "",
      "::: lemma:Second",
      "body",
      ":::",
    ].join("\n");

    expect(markdownForLineRange(markdown, 2, 4)).toBe(
      ["::: theorem:First", "body", ":::"].join("\n"),
    );
    expect(markdownForLineRange(markdown, 6, 8)).toBe(
      ["::: lemma:Second", "body", ":::"].join("\n"),
    );
  });
});

describe("blockAwareLineRange", () => {
  const markdown = [
    "::: definition:First",
    "body",
    ":::",
    "",
    "::: theorem:Display math",
    "before",
    "$$",
    "a^2+b^2=c^2",
    "$$",
    ":::",
    "",
    "::: proposition:After",
    "body",
    ":::",
  ].join("\n");
  const blocks = parse(markdown);

  it("extends a section through a block split by display math", () => {
    expect(blockAwareLineRange(0, 5, blocks)).toEqual({
      lineStart: 0,
      lineEnd: 9,
      fullyCovered: false,
    });
  });

  it("suppresses a section wholly inside an earlier block", () => {
    expect(blockAwareLineRange(6, 8, blocks)).toEqual({
      lineStart: 10,
      lineEnd: 8,
      fullyCovered: true,
    });
  });

  it("resumes after a continued block and includes following blocks", () => {
    expect(blockAwareLineRange(9, 13, blocks)).toEqual({
      lineStart: 10,
      lineEnd: 13,
      fullyCovered: false,
    });
  });

  it("keeps the text that follows a continued block's closing line", () => {
    const tail = parse([
      "::: theorem",
      "$$",
      "x",
      "$$",
      ":::",
      "after",
    ].join("\n"));
    expect(blockAwareLineRange(4, 5, tail)).toEqual({
      lineStart: 5,
      lineEnd: 5,
      fullyCovered: false,
    });
  });

  it("returns null for a section of ordinary Markdown", () => {
    expect(blockAwareLineRange(3, 3, blocks)).toBeNull();
  });
});

describe("previewBlockForSection", () => {
  const markdown = [
    "::: theorem:Target",
    "body",
    "::: ^target",
    "",
    "::: note",
    "other",
    "::: ^other",
  ].join("\n");
  const blocks = parse(markdown);

  it("restores the whole block from a preview of its closing line", () => {
    expect(previewBlockForSection(
      "::: ^target",
      2,
      2,
      blocks,
    )?.label).toBe("Target");
  });

  it("uses the closing line range when Obsidian omits the section text ID", () => {
    expect(previewBlockForSection("", 6, 6, blocks)?.type).toBe("note");
  });

  it("keeps a full-file preview whole", () => {
    expect(previewBlockForSection(markdown, 0, 6, blocks)).toBeNull();
  });
});
