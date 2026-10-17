import type { ToolContext } from '@prokopai/sdk';

/** Dependency, build, cache and editor directories the file tools never descend into. */
export const SKIP_DIRS = new Set([
  'node_modules',
  '.git',
  '__pycache__',
  'dist',
  'build',
  'target',
  'vendor',
  'bin',
  'obj',
  '.idea',
  '.vscode',
  '.zig-cache',
  'zig-out',
  '.coverage',
  'coverage',
  'tmp',
  'temp',
  '.cache',
  'cache',
  'logs',
  '.venv',
  'venv',
  'env',
  '.next',
  '.nuxt',
  '.output',
  '.svelte-kit',
  '.turbo',
]);

const UNREADABLE = new Set(['EACCES', 'EPERM', 'ENOENT', 'ENOTDIR']);

export interface WalkVisitor {
  /** Descend into subdirectories (default true). */
  recursive?: boolean;
  /** Skips an entry (file or directory) by its path relative to the root. */
  skip?(relativePath: string): boolean;
  /** Called per file in directory order; return false to stop the walk. */
  file(fullPath: string, relativePath: string): Promise<boolean | void>;
}

/**
 * Walks the files under `root` through the tool's filesystem, skipping
 * `SKIP_DIRS` (the root too) and directories it cannot read. Paths passed to
 * the visitor are relative to `root` with forward slashes.
 */
export async function walkFiles(ctx: ToolContext, root: string, visitor: WalkVisitor): Promise<void> {
  let stopped = false;
  const walk = async (dirPath: string): Promise<void> => {
    if (SKIP_DIRS.has(dirPath.split(/[/\\]/).pop() || '')) return;
    try {
      for (const entry of await ctx.fs.readDir(dirPath)) {
        if (stopped) return;
        const fullPath = `${dirPath}/${entry.name}`;
        const relativePath = fullPath.slice(root.length + 1).replace(/\\/g, '/');
        if (visitor.skip?.(relativePath)) continue;
        if (entry.isDirectory) {
          if (visitor.recursive !== false) await walk(fullPath);
        } else if (entry.isFile && await visitor.file(fullPath, relativePath) === false) {
          stopped = true;
        }
      }
    } catch (error) {
      if (!UNREADABLE.has((error as { code?: string }).code ?? '')) throw error;
    }
  };
  await walk(root);
}
