import { Braces, MessageSquareText } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import type { ResponseFormat } from '@prokopai/sdk';

interface ResponseFormatSelectorProps {
  formats: ResponseFormat[];
  selectedId?: string;
  onSelect: (id: string | undefined) => void;
  disabled?: boolean;
}

export function ResponseFormatSelector({
  formats,
  selectedId,
  onSelect,
  disabled,
}: ResponseFormatSelectorProps) {
  const selectedFormat = formats.find((f) => f.id === selectedId);
  const label = selectedFormat ? selectedFormat.name : 'Free Text';
  const tooltip = selectedFormat
    ? `Response format: ${selectedFormat.name}`
    : 'Response format: Free Text';

  if (disabled) {
    return (
      <Button
        variant="ghost"
        size="icon"
        disabled
        aria-label={tooltip}
        title={tooltip}
      >
        <MessageSquareText className="size-4 text-muted-foreground/70" />
      </Button>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          aria-label={tooltip}
          title={tooltip}
        >
          {selectedFormat ? (
            <Braces className="size-4 text-highlight" />
          ) : (
            <MessageSquareText className="size-4 text-muted-foreground" />
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" sideOffset={4} className="w-80">
        <DropdownMenuLabel>{label}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onClick={() => onSelect(undefined)}
          className={!selectedId ? 'bg-accent' : ''}
        >
          <MessageSquareText className="size-4 text-muted-foreground" />
          <span className="ml-2">Free Text (default)</span>
        </DropdownMenuItem>
        {formats.map((format) => {
          const isActive = format.id === selectedId;
          return (
            <DropdownMenuItem
              key={format.id}
              onClick={() => onSelect(format.id)}
              className={isActive ? 'bg-accent' : ''}
            >
              <Braces className="size-4 text-highlight shrink-0" />
              <div className="ml-2 flex flex-col min-w-0">
                <span className="truncate">{format.name}</span>
                {format.description && (
                  <span className="text-xs text-muted-foreground truncate">
                    {format.description}
                  </span>
                )}
              </div>
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
