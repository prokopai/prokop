import type { FilePreviewResponse } from '@prokopai/sdk';
import { MarkdownRenderer } from '@/components/shared/MarkdownRenderer';
import FilePreviewCodeView from './FilePreviewCodeView';
import ImagePreview from './ImagePreview';
import { FileX2, FileQuestion, FileWarning, Download } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface FilePreviewContentProps {
  preview: FilePreviewResponse;
  /** Saves the file; offered where the preview cannot show it. */
  onDownload?: () => void;
}

function StatusPanel({
  icon: Icon,
  title,
  reason,
  name,
  onDownload,
}: {
  icon: typeof FileX2;
  title: string;
  reason: string;
  name: string;
  onDownload?: () => void;
}) {
  return (
    <div className="flex flex-col items-center justify-center h-full text-center p-8">
      <Icon className="size-10 text-muted-foreground mb-4" />
      <p className="text-sm font-medium mb-1">{title}</p>
      <p className="text-sm text-muted-foreground mb-2">{reason}</p>
      <p className="text-xs text-muted-foreground">{name}</p>
      {onDownload && (
        <Button variant="outline" className="mt-4" onClick={onDownload}>
          <Download data-icon="inline-start" />
          Download
        </Button>
      )}
    </div>
  );
}

export default function FilePreviewContent({ preview, onDownload }: FilePreviewContentProps) {
  if (preview.kind === 'markdown') {
    return (
      <div className="h-full overflow-auto p-6 chat-transcript-scrollbar" style={{ WebkitOverflowScrolling: 'touch' }}>
        <MarkdownRenderer>{preview.content}</MarkdownRenderer>
      </div>
    );
  }

  if (preview.kind === 'code') {
    return (
      <FilePreviewCodeView
        content={preview.content}
        path={preview.path}
        language={preview.language}
        showLineNumbers={true}
      />
    );
  }

  if (preview.kind === 'text') {
    return (
      <FilePreviewCodeView
        content={preview.content}
        path={preview.path}
        language={preview.language}
        showLineNumbers={false}
      />
    );
  }

  if (preview.kind === 'image') {
    return <ImagePreview src={preview.dataUrl} name={preview.name} />;
  }

  if (preview.kind === 'binary') {
    return (
      <StatusPanel
        icon={FileX2}
        title="Binary file"
        reason={preview.reason}
        name={preview.name}
        onDownload={onDownload}
      />
    );
  }

  if (preview.kind === 'unsupported') {
    return (
      <StatusPanel
        icon={FileQuestion}
        title="Unsupported file"
        reason={preview.reason}
        name={preview.name}
        onDownload={onDownload}
      />
    );
  }

  if (preview.kind === 'too_large') {
    return (
      <StatusPanel
        icon={FileWarning}
        title="File too large"
        reason={preview.reason}
        name={preview.name}
        onDownload={onDownload}
      />
    );
  }

  return null;
}
