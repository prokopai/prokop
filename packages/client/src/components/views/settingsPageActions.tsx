import { createContext, useContext, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

/**
 * The settings page header has a slot at its right for the page's own
 * actions (Add, search). A panel declares them with `PageActions`; the
 * view mounts them in the header. Outside the view (a workbench editor, a
 * story) they render where they are declared.
 */
const SettingsPageActionsContext = createContext<{ slot: HTMLElement | null; setSlot: (slot: HTMLElement | null) => void } | null>(null);

export function SettingsPageActionsProvider({ children }: { children: ReactNode }) {
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  return <SettingsPageActionsContext.Provider value={{ slot, setSlot }}>{children}</SettingsPageActionsContext.Provider>;
}

/** Where the header mounts page actions; call its ref from the header. */
export function useSettingsPageActionsSlot(): (slot: HTMLElement | null) => void {
  const context = useContext(SettingsPageActionsContext);
  return context?.setSlot ?? (() => {});
}

export function PageActions({ children }: { children: ReactNode }) {
  const context = useContext(SettingsPageActionsContext);
  if (context?.slot) return createPortal(children, context.slot);
  return <div data-slot="page-actions" className="flex flex-wrap items-center justify-end gap-1.5 px-3 pt-3 sm:px-4 sm:pt-4">{children}</div>;
}
