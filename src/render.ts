import {
  MarkdownRenderer,
  type App,
  type Component,
} from "obsidian";

import type { ParsedBlock } from "./parser";
import { displayNameForType } from "./block-name";
import {
  PROOF_TYPE,
  type BlockDefinition,
  type Typography,
} from "./settings-model";

function applyTypography(
  element: HTMLElement,
  section: "title" | "body",
  typography: Typography,
): void {
  const bold = typography.style === "bold" ||
    typography.style === "bold-italic";
  const italic = typography.style === "italic" ||
    typography.style === "bold-italic";
  element.style.setProperty(
    `--math-block-${section}-family`,
    typography.family,
  );
  element.style.setProperty(
    `--math-block-${section}-style`,
    italic ? "italic" : "normal",
  );
  element.style.setProperty(
    `--math-block-${section}-weight`,
    bold ? "650" : "400",
  );
}

export async function renderBlock(
  app: App,
  block: ParsedBlock,
  container: HTMLElement,
  sourcePath: string,
  component: Component,
  definition: BlockDefinition,
): Promise<void> {
  const blockElement = container.createDiv({
    cls: `math-block math-block-${block.type}`,
  });
  applyTypography(blockElement, "title", definition.title);
  applyTypography(blockElement, "body", definition.body);
  const title = blockElement.createDiv({ cls: "math-block-title" });

  title.appendText(displayNameForType(block.type));
  if (block.number !== null) {
    title.appendText(` ${block.number}`);
  }

  if (block.label) {
    title.appendText(" (");
    const renderedLabel = title.createSpan({ cls: "math-block-label" });
    await MarkdownRenderer.render(
      app,
      block.label,
      renderedLabel,
      sourcePath,
      component,
    );
    title.appendText(")");
  }
  title.appendText(".");

  const body = blockElement.createDiv({ cls: "math-block-body" });
  await MarkdownRenderer.render(app, block.body, body, sourcePath, component);

  if (block.type === PROOF_TYPE) {
    const tombstone = body.createSpan({ cls: "math-block-tombstone" });
    tombstone.setAttribute("aria-label", "End of proof");
    tombstone.textContent = "∎";
  }
}
