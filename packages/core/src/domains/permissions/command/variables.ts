/**
 * Variables a script sets for itself (`ROOT=/repo; rm -rf "$ROOT/build"`).
 *
 * A `$NAME` operand is unknown to the analyzer, so a delete target built from
 * one is catastrophic and every path from one asks. When the same script set
 * the variable, the analyzer can judge the value instead. A wrong value would
 * misjudge a path, so a variable is known only when its value is certain:
 *
 * - The assignment surely ran: it starts a statement, or sits earlier in the
 *   same `&&` chain as the use. After `||`, in a pipeline stage, in the
 *   background, inside `if/for/while/case/{}` or `( )`, or as a command
 *   prefix (`X=1 cmd`), the variable becomes unknown again.
 * - Nothing else changed it: any other assignment form, a mutating builtin
 *   naming it (`read`, `unset`, `for X in`, `printf -v`...), `eval`/`source`,
 *   a function definition (it may assign when called) or setting `IFS`
 *   makes it, or everything, unknown.
 * - The value is plain: no spaces, globs, quotes, substitutions or `$` left
 *   after expanding known variables. Only `$NAME` and `${NAME}` expand.
 *
 * Environment variables are never known: they come from outside the script.
 */

import { ASSIGNMENT_WORD, type CommandWord, type SegmentStructure } from './structure';

/** Values a path operand can safely become (no splitting, no globbing). */
const PLAIN_VALUE = /^[A-Za-z0-9_./~@%:,+=-]*$/;
const REFERENCE = /\$(?:\{([A-Za-z_][A-Za-z0-9_]*)\}|([A-Za-z_][A-Za-z0-9_]*))/g;
const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** Builtins that change the variables they name. */
const MUTATING_BUILTINS = new Set([
  'read', 'unset', 'mapfile', 'readarray', 'getopts', 'printf', 'let',
  'declare', 'typeset', 'local', 'readonly', 'export', 'for', 'select',
]);
/** Commands that can change any variable. */
const OPAQUE_BUILTINS = new Set(['eval', 'source', '.', 'trap']);
/** `${NAME:=x}`, `${NAME=x}` and other operator forms may assign NAME. */
const OPERATOR_EXPANSION = /\$\{([A-Za-z_][A-Za-z0-9_]*)[^}A-Za-z0-9_]/g;
/** Plain declarations whose `NAME=value` words assign like a bare assignment. */
const DECLARATIONS = new Set(['export', 'readonly', 'local', 'declare', 'typeset']);

export type KnownVariables = ReadonlyMap<string, string>;

/** Expands `$NAME`/`${NAME}` from `known`; null unless every reference is
 * known and no other expansion remains. */
export function expandKnown(text: string, known: KnownVariables): string | null {
  if (!text.includes('$')) return text;
  let unknown = false;
  const expanded = text.replace(REFERENCE, (match, braced?: string, bare?: string) => {
    const value = known.get(braced ?? bare!);
    if (value === undefined) {
      unknown = true;
      return match;
    }
    return value;
  });
  return unknown || expanded.includes('$') ? null : expanded;
}

/** Words with known variables expanded. Unquoted words that expand to
 * nothing disappear, as they do in the shell. */
export function expandWords<T extends CommandWord>(words: readonly T[], known: KnownVariables): T[] {
  if (known.size === 0) return [...words];
  const result: T[] = [];
  for (const word of words) {
    if (!word.text.includes('$') || word.literalDollar || word.text.includes('\\')) {
      result.push(word);
      continue;
    }
    const expanded = expandKnown(word.text, known);
    if (expanded === null) result.push(word);
    else if (expanded !== '' || word.quoted) result.push({ ...word, text: expanded });
  }
  return result;
}

/** How a segment sits in the script, for deciding whether its assignments
 * surely ran and persist. */
export interface SegmentPlacement {
  /** Operator before the segment; null at the start of the script. */
  before: string | null;
  /** Operator after the segment; null at the end. */
  after: string | null;
  /** Inside a compound command or subshell opened by an earlier segment or
   * this one. */
  nested: boolean;
}

/** Tracks the variables a script has set, segment by segment. */
export class ScriptVariables {
  /** Known for every later segment. */
  private readonly statement = new Map<string, string>();
  /** Known only within the current `&&` chain. */
  private chain = new Map<string, string>();
  private trustNothing = false;

  constructor(inherited?: KnownVariables) {
    for (const [name, value] of inherited ?? []) this.statement.set(name, value);
  }

  /** Variables known to a segment with the given leading operator. */
  visible(before: string | null): KnownVariables {
    if (before !== '&&') {
      // The chain ended: its assignments may not have run.
      for (const name of this.chain.keys()) this.statement.delete(name);
      this.chain = new Map();
    }
    return new Map([...this.statement, ...this.chain]);
  }

  /** Records what a segment did to variables, after it was analyzed. */
  record(structure: SegmentStructure, allWords: readonly CommandWord[], placement: SegmentPlacement): void {
    if (this.trustNothing) return;
    const base = structure.words[0]?.text.replace(/.*\//, '') ?? '';
    if (structure.definesFunction || OPAQUE_BUILTINS.has(base)) return this.forgetAll();
    // Arithmetic expansion runs in this shell and can assign (`$((X=5))`).
    if (allWords.some(word => /\$\(\(/.test(word.text) && word.text.includes('='))) return this.forgetAll();
    // Declaration flags change meaning (`declare -n` makes a name an alias).
    if (DECLARATIONS.has(base) && structure.words.slice(1).some(word => word.text.startsWith('-'))) {
      return this.forgetAll();
    }

    const known = new Map([...this.statement, ...this.chain]);
    const trusted = new Map<string, string | null>();
    const declaration = DECLARATIONS.has(base)
      && structure.words.slice(1).every(word => ASSIGNMENT_WORD.test(word.text) || IDENTIFIER.test(word.text));
    const assignmentOnly = structure.words.length === 0 || declaration;
    const runsHere = !placement.nested && placement.before !== '|' && placement.before !== '||'
      && placement.after !== '|' && placement.after !== '&';
    if (assignmentOnly && runsHere) {
      const words = declaration ? structure.words.slice(1) : structure.assignments;
      for (const word of words) {
        const match = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/s.exec(word.text);
        if (!match) continue;
        const value = word.literalDollar || word.text.includes('\\') ? null : expandKnown(match[2]!, known);
        trusted.set(match[1]!, value !== null && PLAIN_VALUE.test(value) ? value : null);
      }
    }

    // Every other way a name gets assigned makes it unknown.
    const forget = new Set<string>();
    for (const word of [...allWords, ...structure.assignments, ...structure.words]) {
      const name = ASSIGNMENT_WORD.exec(word.text)?.[1];
      if (name && !trusted.has(name)) forget.add(name);
      for (const expansion of word.text.matchAll(OPERATOR_EXPANSION)) forget.add(expansion[1]!);
    }
    if (MUTATING_BUILTINS.has(base)) {
      for (const word of structure.words.slice(1)) {
        const name = ASSIGNMENT_WORD.exec(word.text)?.[1] ?? (IDENTIFIER.test(word.text) ? word.text : undefined);
        if (name && !trusted.has(name)) forget.add(name);
      }
    }
    if (forget.has('IFS') || trusted.has('IFS')) return this.forgetAll();
    for (const name of forget) this.forget(name);

    const surely = placement.before === null || placement.before === ';' || placement.before === '\n'
      || placement.before === '&';
    for (const [name, value] of trusted) {
      if (value === null) {
        this.forget(name);
      } else if (surely) {
        this.chain.delete(name);
        this.statement.set(name, value);
      } else {
        this.chain.set(name, value);
      }
    }
  }

  /** A construct the tracking cannot follow: trust no variable from here on. */
  forgetAll(): void {
    this.trustNothing = true;
    this.statement.clear();
    this.chain.clear();
  }

  private forget(name: string): void {
    this.statement.delete(name);
    this.chain.delete(name);
  }
}
