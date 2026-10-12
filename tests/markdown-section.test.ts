import { describe, expect, it } from "vitest";

import {
  blockAwareLineRange,
  lineStarts,
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

describe("lineStarts", () => {
  it("returns the character offset where each line starts", () => {
    expect(lineStarts("ab\ncde\n\nf")).toEqual([0, 3, 7, 8]);
    expect(lineStarts("a\n")).toEqual([0, 2]);
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
    "",
    "::: lemma:Split",
    "before",
    "$$",
    "x",
    "$$",
    "after",
    "::: ^split",
  ].join("\n");
  const blocks = parse(markdown);

  it("restores the whole block from a preview of its closing line", () => {
    expect(previewBlockForSection("::: ^target", blocks)?.label).toBe("Target");
  });

  it("restores the whole block from the text after its last display math", () => {
    expect(previewBlockForSection("after\n::: ^split", blocks)?.label)
      .toBe("Split");
  });

  it("leaves a preview of a whole block to the section path", () => {
    const block = "::: theorem:Target\nbody\n::: ^target";
    expect(previewBlockForSection(block, blocks)).toBeNull();
  });

  it("keeps a heading section that ends with a block", () => {
    const section = "# Heading\n\n::: note\nother\n::: ^other";
    expect(previewBlockForSection(section, blocks)).toBeNull();
  });

  it("keeps a full-file preview whole", () => {
    expect(previewBlockForSection(markdown, blocks)).toBeNull();
    const note = ["::: theorem", "$$", "x", "$$", "::: ^end"].join("\n");
    expect(previewBlockForSection(note, parse(note))).toBeNull();
  });

  it("ignores an empty section", () => {
    expect(previewBlockForSection("", blocks)).toBeNull();
  });
});
