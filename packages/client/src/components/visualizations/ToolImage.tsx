import { memo } from 'react';
import { useServerUrl } from '@/contexts/ServerClientContext';
import { buildApiUrl } from '@/config/urls';

/** An image a tool produced, shown at reading size; clicking opens it full size. */
export const ToolImage = memo(function ToolImage({ url, alt }: { url: string; alt?: string }) {
  const serverUrl = useServerUrl();
  const src = serverUrl ? buildApiUrl(serverUrl, url) : url;
  return (
    <a href={src} target="_blank" rel="noopener noreferrer" className="block w-fit" title="Open full size">
      <img src={src} alt={alt ?? 'Generated image'} loading="lazy" className="max-h-96 max-w-full rounded-lg object-contain" />
    </a>
  );
});
