import type { PullRequestComment, PullRequestDetail, PullRequestThread } from '@prokopai/sdk';
import { displayPath } from './shared';

/** Open review threads: what still needs a change. Outdated threads point at code that has since moved. */
export function openThreads(pr: PullRequestDetail): PullRequestThread[] {
  return pr.threads.filter((t) => !t.resolved && !t.outdated);
}

function location(thread: PullRequestThread): string {
  if (!thread.path) return 'General';
  const line = thread.line ? `:${thread.line}${thread.side === 'LEFT' ? ' (old)' : ''}` : '';
  return `${displayPath(thread.path)}${line}`;
}

function comments(list: PullRequestComment[]): string {
  return list.map((c) => `**${c.author.name}:**\n\n${c.body.trim()}`).join('\n\n');
}

/** One comment; on a file it carries its location, so a pasted comment still says where it applies. */
export function commentMarkdown(comment: PullRequestComment, thread?: PullRequestThread): string {
  return thread?.path ? `### ${location(thread)}\n\n${comments([comment])}\n` : comment.body;
}

/**
 * Review feedback as one markdown document, ready to paste into a session.
 * `open` keeps only unresolved, current threads; `all` adds resolved and outdated threads
 * (marked) and the general conversation.
 */
export function reviewMarkdown(pr: PullRequestDetail, scope: 'open' | 'all'): string {
  const threads = (scope === 'open' ? openThreads(pr) : pr.threads)
    .filter((t) => t.comments.length > 0)
    .sort(
      (a, b) =>
        Number(!a.path) - Number(!b.path) ||
        displayPath(a.path ?? '').localeCompare(displayPath(b.path ?? '')) ||
        (a.line ?? 0) - (b.line ?? 0),
    );
  const sections = threads.map((t) => {
    const marks = [t.resolved && 'resolved', t.outdated && 'outdated'].filter(Boolean);
    return `### ${location(t)}${marks.length ? ` (${marks.join(', ')})` : ''}\n\n${comments(t.comments)}`;
  });
  if (scope === 'all' && pr.comments.length) sections.push(`### Conversation\n\n${comments(pr.comments)}`);
  return [`## Review comments on #${pr.number}: ${pr.title}`, ...sections].join('\n\n') + '\n';
}
