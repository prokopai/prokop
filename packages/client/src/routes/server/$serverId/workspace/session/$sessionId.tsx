import { createFileRoute } from '@tanstack/react-router';
import { validateBoardSearch } from '@/lib/boardSearch';

export const Route = createFileRoute('/server/$serverId/workspace/session/$sessionId')({
  validateSearch: validateBoardSearch,
});
