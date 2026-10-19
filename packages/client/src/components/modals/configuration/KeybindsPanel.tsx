import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { RotateCcw } from 'lucide-react';
import { useRecordHotkeys } from 'react-hotkeys-hook';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { SettingsGroup } from '@/components/ui/settings-group';
import { SettingsRow } from '@/components/ui/settings-row';
import {
  bindingFromRecordedKeys,
  findKeybindingConflict,
  formatKeybinding,
  isReservedBrowserBinding,
  KEYBINDING_COMMANDS,
  resolveKeybinding,
  type KeybindingCommand,
  type KeybindingCommandId,
} from '@/lib/keybindings';
import { useKeybindingStore } from '@/stores/keybindingStore';

interface PendingAssignment {
  id: KeybindingCommandId;
  binding: string;
  conflict: KeybindingCommand | null;
  reserved: boolean;
}

const CATEGORIES = ['Navigation', 'Chat', 'Tabs', 'Terminal', 'Editor'] as const;
const CATEGORY_NOTES: Partial<Record<(typeof CATEGORIES)[number], string>> = {
  Terminal: 'Work while the terminal or its tabs have focus.',
};
const ESCAPE_SEQUENCE_TIMEOUT_MS = 500;

export function KeybindsPanel() {
  const overrides = useKeybindingStore((state) => state.overrides);
  const setBinding = useKeybindingStore((state) => state.setBinding);
  const unsetBinding = useKeybindingStore((state) => state.unsetBinding);
  const resetBinding = useKeybindingStore((state) => state.resetBinding);
  const resetAllBindings = useKeybindingStore((state) => state.resetAllBindings);
  const [editingId, setEditingId] = useState<KeybindingCommandId | null>(null);
  const [pending, setPending] = useState<PendingAssignment | null>(null);
  const [escapePending, setEscapePending] = useState(false);
  const escapeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [recordedKeys, { start, stop, resetKeys, isRecording }] = useRecordHotkeys();
  const recordedBinding = useMemo(
    () => bindingFromRecordedKeys(recordedKeys),
    [recordedKeys],
  );
  const overrideCount = Object.keys(overrides).length;

  const clearEscapeTimer = useCallback(() => {
    if (escapeTimerRef.current !== null) {
      clearTimeout(escapeTimerRef.current);
      escapeTimerRef.current = null;
    }
    setEscapePending(false);
  }, []);

  const cancelRecording = useCallback(() => {
    clearEscapeTimer();
    stop();
    resetKeys();
    setEditingId(null);
  }, [clearEscapeTimer, resetKeys, stop]);

  const finishRecording = useCallback((id: KeybindingCommandId, binding: string) => {
    clearEscapeTimer();
    stop();
    resetKeys();
    setEditingId(null);
    const assignment = {
      id,
      binding,
      conflict: findKeybindingConflict(id, binding, overrides),
      reserved: isReservedBrowserBinding(binding),
    };
    if (assignment.conflict || assignment.reserved) {
      setPending(assignment);
    } else {
      setBinding(id, binding);
    }
  }, [clearEscapeTimer, overrides, resetKeys, setBinding, stop]);

  useEffect(() => clearEscapeTimer, [clearEscapeTimer]);

  useEffect(() => {
    if (!editingId || !isRecording || !recordedBinding) return;
    if (recordedBinding === 'escape') {
      cancelRecording();
      return;
    }

    finishRecording(editingId, recordedBinding);
  }, [cancelRecording, editingId, finishRecording, isRecording, recordedBinding]);

  useEffect(() => {
    if (!editingId || !isRecording) return;

    const captureEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;

      event.preventDefault();
      event.stopImmediatePropagation();
      const hasModifier = event.altKey || event.ctrlKey || event.metaKey || event.shiftKey;
      if (!hasModifier) {
        if (escapeTimerRef.current !== null) {
          finishRecording(editingId, 'escape>escape');
          return;
        }

        setEscapePending(true);
        escapeTimerRef.current = setTimeout(() => {
          escapeTimerRef.current = null;
          setEscapePending(false);
          finishRecording(editingId, 'escape');
        }, ESCAPE_SEQUENCE_TIMEOUT_MS);
        return;
      }

      const keys = new Set<string>(['escape']);
      if (event.altKey) keys.add('alt');
      if (event.ctrlKey) keys.add('ctrl');
      if (event.metaKey) keys.add('meta');
      if (event.shiftKey) keys.add('shift');
      const binding = bindingFromRecordedKeys(keys);
      if (binding) finishRecording(editingId, binding);
    };

    window.addEventListener('keydown', captureEscape, true);
    return () => window.removeEventListener('keydown', captureEscape, true);
  }, [cancelRecording, editingId, finishRecording, isRecording]);

  const startRecording = (id: KeybindingCommandId) => {
    clearEscapeTimer();
    resetKeys();
    setEditingId(id);
    start();
  };

  const confirmAssignment = () => {
    if (!pending) return;
    if (pending.conflict) unsetBinding(pending.conflict.id);
    setBinding(pending.id, pending.binding);
    setPending(null);
  };

  return (
    <div className="flex flex-col gap-4 p-3 sm:p-4">
      <SettingsGroup description="Some browser and operating-system shortcuts cannot be captured by this page. Navigation inside individual widgets stays fixed.">
        <SettingsRow label="Custom shortcuts" description={overrideCount === 0 ? 'All shortcuts are at their defaults.' : `${overrideCount} changed`}>
          <Button type="button" variant="outline" disabled={overrideCount === 0} onClick={resetAllBindings}>
            <RotateCcw data-icon="inline-start" />
            Reset all
          </Button>
        </SettingsRow>
      </SettingsGroup>

      {CATEGORIES.map((category) => (
        <SettingsGroup key={category} label={category} description={CATEGORY_NOTES[category]} aria-label={`${category} shortcuts`}>
          {KEYBINDING_COMMANDS.filter((command) => command.category === category).map((command) => {
            const binding = resolveKeybinding(command.id, overrides);
            const customized = Object.prototype.hasOwnProperty.call(overrides, command.id);
            const isEditing = editingId === command.id;

            return (
              <SettingsRow key={command.id} label={<span className="flex items-center gap-2">{command.label}{customized && <Badge variant="secondary">Custom</Badge>}</span>}>
                <span className="flex flex-wrap items-center gap-1.5">
                  {isEditing ? (
                    <>
                      <span role="status" aria-live="polite" className="text-xs text-muted-foreground">
                        {escapePending
                          ? 'Press Escape again for a sequence'
                          : 'Press a shortcut. Use Cancel to stop recording.'}
                      </span>
                      <Button type="button" variant="outline" size="xs" onClick={cancelRecording}>
                        Cancel
                      </Button>
                    </>
                  ) : (
                    <>
                      {binding ? (
                        <kbd className="rounded-sm bg-muted px-1.5 py-0.5 font-mono text-xs">
                          {formatKeybinding(binding)}
                        </kbd>
                      ) : (
                        <span className="text-xs text-muted-foreground">No shortcut</span>
                      )}
                      <Button
                        type="button"
                        variant="outline"
                        size="xs"
                        onClick={() => startRecording(command.id)}
                        aria-label={`Change ${command.label}`}
                      >
                        Change
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="xs"
                        disabled={binding === null}
                        onClick={() => unsetBinding(command.id)}
                        aria-label={`Unset ${command.label}`}
                      >
                        Unset
                      </Button>
                      {customized && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="xs"
                          onClick={() => resetBinding(command.id)}
                          aria-label={`Reset ${command.label}`}
                        >
                          Reset
                        </Button>
                      )}
                    </>
                  )}
                </span>
              </SettingsRow>
            );
          })}
        </SettingsGroup>
      ))}

      <Dialog open={pending !== null} onOpenChange={(open) => !open && setPending(null)}>
        <DialogContent showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>
              {pending?.conflict ? 'Replace existing shortcut?' : 'Assign browser shortcut?'}
            </DialogTitle>
            <DialogDescription>
              {pending?.conflict
                ? `${formatKeybinding(pending.binding)} is assigned to ${pending.conflict.label}. Replacing it will leave that command unassigned.`
                : `${pending ? formatKeybinding(pending.binding) : ''} is commonly reserved by the browser or operating system and might not reach Prokop.`}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setPending(null)}>
              Cancel
            </Button>
            <Button type="button" onClick={confirmAssignment}>
              {pending?.conflict ? 'Replace' : 'Assign anyway'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
