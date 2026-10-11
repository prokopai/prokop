import { act, fireEvent, screen } from '@testing-library/react';
import type { Editor } from '@tiptap/core';
import { documentToPrompt, promptToDocument } from '@/lib/composerDocument';

/** The chat composer's editable element, optionally found by its placeholder. */
export function getComposer(placeholder?: string): HTMLElement {
  if (placeholder) {
    const element = document.querySelector<HTMLElement>(`[data-chat-input="true"][aria-placeholder="${placeholder}"]`);
    if (!element) throw new Error(`No composer with placeholder "${placeholder}"`);
    return element;
  }
  return screen.getByRole('textbox');
}

function editorOf(element: HTMLElement): Editor {
  const editor = (element as HTMLElement & { editor?: Editor }).editor;
  if (!editor) throw new Error('Composer has no editor');
  return editor;
}

/** Replaces the composer content, like typing it, with the cursor at the end. */
export function typeInComposer(element: HTMLElement, text: string): void {
  const editor = editorOf(element);
  act(() => {
    editor.commands.setContent(promptToDocument(text), { emitUpdate: true });
    // Not focus(): its delayed refocus reads as focus leaving an open popover.
    editor.commands.setTextSelection(editor.state.doc.content.size);
  });
}

export function composerText(element: HTMLElement): string {
  return documentToPrompt(editorOf(element).getJSON());
}

export function pressInComposer(element: HTMLElement, key: string, init: KeyboardEventInit = {}): void {
  act(() => {
    fireEvent.keyDown(element, { key, ...init });
  });
}
