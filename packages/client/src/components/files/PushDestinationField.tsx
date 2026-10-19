import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { cn } from '@/lib/utils';

export interface PushDestinationFieldProps {
  remotes: string[];
  remote: string;
  branch: string;
  disabled?: boolean;
  onRemoteChange: (remote: string) => void;
  onBranchChange: (branch: string) => void;
  className?: string;
}

/**
 * The push target as one field, read like a path: `origin / main`.
 *
 * With a single remote the remote is a muted prefix, not a control; with
 * several it is a borderless select segment inside the same outline. The
 * focus ring wraps the whole group, so typing in the branch part still
 * reads as editing one input.
 */
export function PushDestinationField({ remotes, remote, branch, disabled, onRemoteChange, onBranchChange, className }: PushDestinationFieldProps) {
  const single = remotes.length === 1;
  return <div className={cn('flex h-7 min-w-0 flex-1 items-center rounded-md border border-input text-xs transition-colors focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50 dark:bg-input/30', disabled && 'opacity-50', className)}>
    {single
      ? <span className="shrink-0 pl-2 text-muted-foreground" title="Remote">{remotes[0]}</span>
      : <Select value={remote} disabled={disabled} onValueChange={onRemoteChange}>
        <SelectTrigger size="default" aria-label="Remote" className="h-full shrink-0 gap-1 rounded-none border-0 bg-transparent pr-1 pl-2 text-xs shadow-none focus-visible:ring-0 dark:bg-transparent dark:hover:bg-transparent [&_svg]:size-3"><SelectValue placeholder="Remote" /></SelectTrigger>
        <SelectContent>{remotes.map((name) => <SelectItem key={name} value={name}>{name}</SelectItem>)}</SelectContent>
      </Select>}
    <span aria-hidden className="shrink-0 px-1 text-muted-foreground/60 select-none">/</span>
    <Input aria-label="Remote branch" className="h-full min-w-0 flex-1 rounded-none border-0 bg-transparent pl-0 font-mono text-xs focus-visible:border-transparent focus-visible:ring-0 disabled:bg-transparent md:text-xs dark:bg-transparent dark:disabled:bg-transparent" value={branch} disabled={disabled} onChange={(event) => onBranchChange(event.target.value)} />
  </div>;
}
