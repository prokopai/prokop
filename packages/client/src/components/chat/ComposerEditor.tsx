import { createContext, forwardRef, use, useEffect, useImperativeHandle, useLayoutEffect, useRef } from 'react';
import { Node, type Editor, type JSONContent } from '@tiptap/core';
import Document from '@tiptap/extension-document';
import Paragraph from '@tiptap/extension-paragraph';
import Text from '@tiptap/extension-text';
import { Placeholder, UndoRedo } from '@tiptap/extensions';
import { EditorContent, NodeViewWrapper, ReactNodeViewRenderer, useEditor, type NodeViewProps } from '@tiptap/react';
import {
  contextReferenceLabel,
  formatContextReference,
  type ContextReference,
  type FileContextReference,
} from '@prokopai/sdk';
import { ContextChip } from './ContextChip';
import {
  CONTEXT_REFERENCE_NODE,
  documentToPrompt,
  promptToDocument,
  promptToParagraphs,
  referenceNode,
} from '@/lib/composerDocument';
import { cn } from '@/lib/utils';

/** An unfinished `@query` or `/command` before the cursor. Positions are document positions. */
export interface ComposerTrigger {
  kind: 'file' | 'prompt';
  query: string;
  from: number;
  to: number;
}

export interface ComposerEditorHandle {
  focus(): void;
  /** Replaces the trigger text with a reference chip or plain text. */
  replaceTrigger(trigger: ComposerTrigger, content: { reference: ContextReference } | { text: string }): void;
  /** Inserts a chip at the cursor, or at the end when the composer is not focused. */
  insertReference(reference: ContextReference): void;
}

interface ComposerEditorProps {
  value: string;
  onChange(value: string): void;
  onTriggerChange(trigger: ComposerTrigger | null): void;
  /** Return true when the key was handled (autocomplete navigation, send). */
  onKeyDown(event: KeyboardEvent): boolean;
  /** Return true when the pasted files were taken as attachments. */
  onPasteFiles?(files: File[]): boolean;
  onOpenFile?(reference: FileContextReference): void;
  placeholder: string;
  disabled?: boolean;
  className?: string;
}

const ComposerActions = createContext<{ onOpenFile?: (reference: FileContextReference) => void }>({});

function ContextReferenceView({ node, selected }: NodeViewProps) {
  const { onOpenFile } = use(ComposerActions);
  const reference = node.attrs.reference as ContextReference | null;
  return (
    <NodeViewWrapper as="span" className="mx-px" contentEditable={false}>
      {reference && <ContextChip reference={reference} selected={selected} onOpenFile={onOpenFile} />}
    </NodeViewWrapper>
  );
}

const ContextReferenceNode = Node.create({
  name: CONTEXT_REFERENCE_NODE,
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,
  draggable: false,
  addAttributes() {
    return { reference: { default: null, rendered: false } };
  },
  renderHTML({ node }) {
    const reference = node.attrs.reference as ContextReference | null;
    return ['span', { 'data-context-reference': '' }, reference ? contextReferenceLabel(reference) : ''];
  },
  renderText({ node }) {
    const reference = node.attrs.reference as ContextReference | null;
    return reference ? formatContextReference(reference) : '';
  },
  addNodeView() {
    return ReactNodeViewRenderer(ContextReferenceView, { as: 'span' });
  },
});

const FILE_TRIGGER = /(?:^|\s)@([^\s@￼]*)$/;
const PROMPT_TRIGGER = /(?:^|\s)\/(\S*)$/;

function readTrigger(editor: Editor): ComposerTrigger | null {
  const { selection } = editor.state;
  if (!selection.empty) return null;
  const { $from } = selection;
  const before = $from.parent.textBetween(0, $from.parentOffset, undefined, '￼');
  const prompt = PROMPT_TRIGGER.exec(before);
  if (prompt) return { kind: 'prompt', query: prompt[1], from: $from.pos - prompt[1].length - 1, to: $from.pos };
  const file = FILE_TRIGGER.exec(before);
  if (file) return { kind: 'file', query: file[1], from: $from.pos - file[1].length - 1, to: $from.pos };
  return null;
}

function sameTrigger(a: ComposerTrigger | null, b: ComposerTrigger | null): boolean {
  return a === b || (!!a && !!b && a.kind === b.kind && a.query === b.query && a.from === b.from && a.to === b.to);
}

/** Inline content for one pasted line, or paragraphs for several. */
function insertableContent(text: string): JSONContent[] {
  const paragraphs = promptToParagraphs(text);
  return paragraphs.length === 1 ? paragraphs[0].content ?? [] : paragraphs;
}

/**
 * The chat composer: a single-purpose TipTap editor whose only rich content is
 * context reference chips. `value` is the prompt string; the editor reparses it
 * when it changes from outside (draft load, restore, clear) and serializes on
 * every edit.
 */
export const ComposerEditor = forwardRef<ComposerEditorHandle, ComposerEditorProps>(function ComposerEditor({
  value,
  onChange,
  onTriggerChange,
  onKeyDown,
  onPasteFiles,
  onOpenFile,
  placeholder,
  disabled = false,
  className,
}, ref) {
  // The editor is created once; its handlers reach the latest props through this ref.
  const props = useRef({ onChange, onTriggerChange, onKeyDown, onPasteFiles });
  useLayoutEffect(() => {
    props.current = { onChange, onTriggerChange, onKeyDown, onPasteFiles };
  });
  const lastValue = useRef(value);
  const lastTrigger = useRef<ComposerTrigger | null>(null);

  const editor = useEditor({
    extensions: [
      Document,
      Paragraph,
      Text,
      UndoRedo,
      ContextReferenceNode,
      // The placeholder effect below keeps this attribute current.
      Placeholder.configure({ placeholder: ({ editor: current }) => current.view.dom.getAttribute('aria-placeholder') ?? '' }),
    ],
    content: promptToDocument(value),
    editable: !disabled,
    shouldRerenderOnTransaction: false,
    editorProps: {
      attributes: {
        role: 'textbox',
        'aria-multiline': 'true',
        'data-chat-input': 'true',
        class: 'composer-editor min-h-[1.5em] whitespace-pre-wrap break-words outline-none',
      },
      handleKeyDown(view, event) {
        if (event.isComposing || event.keyCode === 229) return false;
        if (props.current.onKeyDown(event)) return true;
        if (event.key === 'Enter' && event.shiftKey) {
          // No hard breaks in this schema: Shift+Enter starts a new line.
          const { state, dispatch } = view;
          dispatch(state.tr.split(state.selection.from).scrollIntoView());
          return true;
        }
        return false;
      },
      handlePaste(view, event) {
        const files = Array.from(event.clipboardData?.files ?? []);
        if (files.length > 0 && props.current.onPasteFiles?.(files)) return true;
        const text = event.clipboardData?.getData('text/plain');
        const current = (view.dom as HTMLElement & { editor?: Editor }).editor;
        if (!text || !current) return false;
        // Pasted prompt text keeps its references as chips.
        current.chain().insertContent(insertableContent(text.replace(/\r\n?/g, '\n'))).scrollIntoView().run();
        return true;
      },
      handleDrop(_view, event) {
        // Files go to the form's attachment drop handler.
        return (event.dataTransfer?.files.length ?? 0) > 0;
      },
      clipboardTextSerializer(slice) {
        return documentToPrompt({ type: 'doc', content: slice.content.toJSON() as JSONContent[] });
      },
    },
    onUpdate({ editor: current }) {
      const text = documentToPrompt(current.getJSON());
      lastValue.current = text;
      props.current.onChange(text);
      emitTrigger(current);
    },
    // No reset on blur: clicking an autocomplete row blurs the editor first.
    onSelectionUpdate({ editor: current }) {
      emitTrigger(current);
    },
  }, []);

  function emitTrigger(current: Editor | null): void {
    const trigger = current ? readTrigger(current) : null;
    if (sameTrigger(trigger, lastTrigger.current)) return;
    lastTrigger.current = trigger;
    props.current.onTriggerChange(trigger);
  }

  // Outside changes to the prompt (draft load, restore, clear after send).
  useEffect(() => {
    if (!editor || value === lastValue.current) return;
    lastValue.current = value;
    editor.commands.setContent(promptToDocument(value), { emitUpdate: false });
    editor.commands.setTextSelection(editor.state.doc.content.size);
    emitTrigger(editor.isFocused ? editor : null);
  }, [editor, value]);

  useEffect(() => {
    if (!editor || editor.isDestroyed) return;
    editor.setEditable(!disabled, false);
    editor.view.dom.setAttribute('aria-disabled', String(disabled));
  }, [editor, disabled]);

  useEffect(() => {
    if (!editor || editor.isDestroyed) return;
    editor.view.dom.setAttribute('aria-placeholder', placeholder);
    editor.view.dom.setAttribute('aria-label', placeholder);
    // The placeholder decoration only recomputes on a transaction.
    editor.view.dispatch(editor.state.tr.setMeta('addToHistory', false));
  }, [editor, placeholder]);

  useImperativeHandle(ref, () => ({
    focus() {
      editor?.commands.focus();
    },
    replaceTrigger(trigger, content) {
      if (!editor) return;
      const insert = 'reference' in content
        ? [referenceNode(content.reference), { type: 'text', text: ' ' }]
        : content.text;
      editor.chain().focus().insertContentAt({ from: trigger.from, to: trigger.to }, insert).run();
    },
    insertReference(reference) {
      if (!editor) return;
      const position = editor.isFocused ? editor.state.selection.from : editor.state.doc.content.size - 1;
      const before = editor.state.doc.textBetween(Math.max(0, position - 1), position, '\n', '\uFFFC');
      const content: JSONContent[] = [referenceNode(reference), { type: 'text', text: ' ' }];
      if (before && !/\s/.test(before)) content.unshift({ type: 'text', text: ' ' });
      editor.chain().insertContentAt(position, content).focus().run();
    },
  }), [editor]);

  return (
    <ComposerActions value={{ onOpenFile }}>
      <EditorContent editor={editor} className={cn(disabled && 'cursor-default', className)} aria-disabled={disabled || undefined} />
    </ComposerActions>
  );
});
