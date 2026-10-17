/**
 * The real command of a shell segment, and the nesting it opens or closes.
 *
 * The analyzer judges a segment by its command name and operands. Prefixes
 * (`FOO=1`, `!`, `if`, `then`, `do`, `{`, `(`, case patterns, function
 * definitions) and transparent wrappers (`env`, `command`, `nohup`, `time`,
 * `timeout`, `nice`, `stdbuf`, `exec`) run the command after them, so they
 * are skipped; otherwise `time rm -rf /` would be judged as `time`.
 *
 * Nesting matters to the callers: an assignment or `cd` inside `if/for/{}`
 * may not run, and one inside `( )` does not outlive the subshell.
 */

export interface Span {
  start: number;
  end: number;
}

export interface CommandWord extends Span {
  text: string;
  redirect: 'none' | 'write' | 'read';
  quoted: boolean;
  /** A `$` here is literal (single-quoted or escaped), never an expansion. */
  literalDollar?: boolean;
}

/** `NAME=`, `NAME+=`, `NAME[i]=`: an assignment word; group 1 is the name. */
export const ASSIGNMENT_WORD = /^([A-Za-z_][A-Za-z0-9_]*)(?:\[[^\]]*\])?\+?=/;

/** Words that start a compound command and run what follows them. */
const RESERVED_PREFIXES = new Set(['!', 'if', 'then', 'else', 'elif', 'do', 'while', 'until', '{', 'function']);
/** Compound commands whose body may run zero times or many times. */
const COMPOUND_OPENERS = new Set(['if', 'while', 'until', 'for', 'select', 'case', '{']);
const COMPOUND_CLOSERS = new Set(['fi', 'done', 'esac', '}']);

const FUNCTION_DEFINITION = /^[A-Za-z_][\w.:-]*\(\)$/;

/** Options that take a separate value, per wrapper. */
const WRAPPER_VALUE_FLAGS: Record<string, ReadonlySet<string>> = {
  env: new Set(['-u', '--unset', '-C', '--chdir', '-S', '--split-string']),
  command: new Set(),
  builtin: new Set(),
  nohup: new Set(),
  setsid: new Set(),
  time: new Set(['-f', '--format', '-o', '--output']),
  exec: new Set(['-a']),
  nice: new Set(['-n', '--adjustment']),
  timeout: new Set(['-s', '--signal', '-k', '--kill-after']),
  stdbuf: new Set(['-i', '-o', '-e', '--input', '--output', '--error']),
};

function baseName(text: string): string {
  return text.replace(/.*\//, '').toLowerCase();
}

/** Index of the wrapped command after a wrapper at `index`, or `index`. */
function skipWrapper(words: readonly CommandWord[], index: number): number {
  const base = baseName(words[index]!.text);
  const valueFlags = WRAPPER_VALUE_FLAGS[base];
  if (!valueFlags) return index;
  let i = index + 1;
  while (i < words.length) {
    const text = words[i]!.text;
    if (text === '--') return i + 1;
    if (base === 'env' && ASSIGNMENT_WORD.test(text)) { i += 1; continue; }
    if (!text.startsWith('-')) break;
    i += valueFlags.has(text) ? 2 : 1;
  }
  // timeout's first operand is its duration, not the command.
  if (base === 'timeout' && i < words.length) i += 1;
  return i;
}

export interface SegmentStructure {
  /** The command and its operands; prefixes removed, `(`/`)` trimmed. */
  words: CommandWord[];
  /** Assignment words before the command (`FOO=1 cmd`) or alone (`FOO=1`). */
  assignments: CommandWord[];
  compoundOpens: number;
  compoundCloses: number;
  subshellOpens: number;
  subshellCloses: number;
  definesFunction: boolean;
}

function trimmed(word: CommandWord, text: string): CommandWord {
  return { ...word, text };
}

/** Finds the command a segment runs. `words` are its non-redirect words. */
export function segmentStructure(words: readonly CommandWord[]): SegmentStructure {
  const result: SegmentStructure = {
    words: [], assignments: [],
    compoundOpens: 0, compoundCloses: 0, subshellOpens: 0, subshellCloses: 0, definesFunction: false,
  };
  // A subshell closes on the segment's last word (`rm -rf y)`, `X=1)`).
  const last = words.at(-1);
  if (last && !last.quoted && /\)+$/.test(last.text) && !/[($`]/.test(last.text)) {
    const closes = /\)+$/.exec(last.text)![0].length;
    result.subshellCloses += closes;
    const rest = last.text.slice(0, -closes);
    words = [...words.slice(0, -1), ...(rest ? [trimmed(last, rest)] : [])];
  }
  let i = 0;
  let inCase = false;
  while (i < words.length) {
    const word = words[i]!;
    const text = word.text;
    if (!word.quoted && text.startsWith('(')) {
      const opens = /^\(+/.exec(text)![0].length;
      result.subshellOpens += opens;
      const rest = text.slice(opens);
      if (!rest) { i += 1; continue; }
      words = [...words.slice(0, i), trimmed(word, rest), ...words.slice(i + 1)];
      continue;
    }
    if (!word.quoted && COMPOUND_CLOSERS.has(text)) {
      result.compoundCloses += 1;
      i += 1;
      continue;
    }
    if (!word.quoted && (FUNCTION_DEFINITION.test(text) || text === 'function')) {
      result.definesFunction = true;
      i += text === 'function' ? 2 : 1;
      continue;
    }
    if (!word.quoted && RESERVED_PREFIXES.has(text)) {
      if (COMPOUND_OPENERS.has(text)) result.compoundOpens += 1;
      i += 1;
      continue;
    }
    if (!word.quoted && (text === 'for' || text === 'select')) {
      // A loop header names its variable and list; it runs nothing itself.
      result.compoundOpens += 1;
      return { ...result, words: words.slice(i) };
    }
    if (!word.quoted && text === 'case') {
      result.compoundOpens += 1;
      inCase = true;
      const pattern = words.findIndex((candidate, at) => at > i && /\)$/.test(candidate.text));
      i = pattern === -1 ? words.length : pattern + 1;
      continue;
    }
    if (ASSIGNMENT_WORD.test(text)) {
      result.assignments.push(word);
      i += 1;
      continue;
    }
    // A case item after `;;` starts with its pattern (`b)`).
    if (i === 0 && !inCase && /\)$/.test(text) && !/[($`]/.test(text)) {
      i += 1;
      continue;
    }
    const wrapped = skipWrapper(words, i);
    if (wrapped !== i) {
      i = wrapped;
      continue;
    }
    break;
  }
  return { ...result, words: words.slice(i) };
}
