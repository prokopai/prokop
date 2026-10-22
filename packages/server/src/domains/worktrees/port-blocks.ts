/**
 * Port blocks for managed worktrees: each worktree that uses `{{port}}` owns
 * a contiguous, aligned block in a fixed range. Pure given a probe; the
 * adapter supplies the real bind check.
 */

export const PORT_RANGE_START = 20_000;
export const PORT_RANGE_END = 29_999;

export interface PortBlock {
  base: number;
  count: number;
}

function overlaps(left: PortBlock, right: PortBlock): boolean {
  return left.base < right.base + right.count && right.base < left.base + left.count;
}

/**
 * The lowest block of `count` ports, aligned to `count` from the range
 * start, that no held block overlaps and whose every port passes `isFree`.
 * Null when the range is exhausted.
 */
export async function allocatePortBlock(
  count: number,
  held: PortBlock[],
  isFree: (port: number) => Promise<boolean>,
): Promise<PortBlock | null> {
  for (let base = PORT_RANGE_START; base + count - 1 <= PORT_RANGE_END; base += count) {
    const candidate = { base, count };
    if (held.some((block) => overlaps(block, candidate))) continue;
    let free = true;
    for (let port = base; port < base + count; port += 1) {
      if (!(await isFree(port))) {
        free = false;
        break;
      }
    }
    if (free) return candidate;
  }
  return null;
}
