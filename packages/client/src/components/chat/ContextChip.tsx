import { File, Folder, SquareTerminal } from 'lucide-react';
import {
  contextReferenceLabel,
  fileReferenceDisplayPath,
  type ContextReference,
  type FileContextReference,
} from '@prokopai/sdk';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { fileIconColor, FOLDER_ICON_COLOR } from '@/components/files/fileIcons';
import { cn } from '@/lib/utils';

interface ContextChipProps {
  /** Absent for a terminal marker whose captured output is missing. */
  reference?: ContextReference;
  label?: string;
  /** Composer selection highlight. */
  selected?: boolean;
  onOpenFile?: (reference: FileContextReference) => void;
}

// Sized in em so the chip sits in running text at any font size.
const CHIP = 'inline-flex h-[1.45em] max-w-full items-center gap-[0.3em] rounded-[0.4em] border bg-card px-[0.4em] align-[-0.2em] text-[0.88em] font-medium leading-none whitespace-nowrap text-foreground [&_svg]:size-[1.1em] [&_svg]:shrink-0';
const INTERACTIVE = 'cursor-pointer transition-colors hover:bg-accent focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring';

function TerminalExcerpt({ reference }: { reference: Extract<ContextReference, { kind: 'terminal' }> }) {
  return (
    <div className="flex max-h-80 flex-col">
      <div className="flex items-center gap-2 border-b px-3 py-2 text-xs">
        <SquareTerminal className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="font-medium">{reference.label}</span>
        {reference.cwd && <span className="min-w-0 truncate text-muted-foreground" title={reference.cwd}>{reference.cwd}</span>}
      </div>
      <pre className="min-h-0 overflow-auto px-3 py-2 font-mono text-xs leading-relaxed whitespace-pre">{reference.text}</pre>
    </div>
  );
}

export function ContextChip({ reference, label, selected = false, onOpenFile }: ContextChipProps) {
  const ring = selected && 'ring-2 ring-ring/60';

  if (!reference) {
    return (
      <span className={cn(CHIP, 'border-dashed opacity-80', ring)} title="Terminal output was not included">
        <SquareTerminal />
        <span className="min-w-0 truncate">{label}</span>
      </span>
    );
  }

  const text = contextReferenceLabel(reference);

  if (reference.kind === 'terminal') {
    return (
      <Popover>
        <PopoverTrigger asChild>
          <button type="button" className={cn(CHIP, INTERACTIVE, ring)} aria-label={`Terminal output: ${text}`}>
            <SquareTerminal className="text-muted-foreground" />
            <span className="min-w-0 truncate">{text}</span>
          </button>
        </PopoverTrigger>
        <PopoverContent className="w-[min(36rem,90vw)] p-0" align="start" onOpenAutoFocus={(event) => event.preventDefault()}>
          <TerminalExcerpt reference={reference} />
        </PopoverContent>
      </Popover>
    );
  }

  const isFolder = reference.path.endsWith('/');
  const Icon = isFolder ? Folder : File;
  const iconColor = isFolder ? FOLDER_ICON_COLOR : fileIconColor(reference.path);
  const content = (
    <>
      <Icon className={iconColor} />
      <span className="min-w-0 truncate">{text}</span>
    </>
  );
  const title = fileReferenceDisplayPath(reference);

  if (!onOpenFile || isFolder) {
    return <span className={cn(CHIP, ring)} title={title}>{content}</span>;
  }
  return (
    <button type="button" className={cn(CHIP, INTERACTIVE, ring)} title={title} onClick={() => onOpenFile(reference)}>
      {content}
    </button>
  );
}
