import { describe, expect, it } from "vitest";

import {
  blockAwareLineRange,
  markdownForLineRange,
  previewBlockForSection,
} from "../src/markdown-section";
import { parseBlocks } from "../src/parser";

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
  const blocks = parseBlocks(markdown);

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
    const tail = parseBlocks([
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
  const blocks = parseBlocks(markdown);

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
