import type { FormQuestion } from '@prokopai/sdk';

/** Claude Code's native question tool. The host answers it: the CLI reads the
 *  user's choices from `updatedInput.answers`, keyed by question text, with
 *  multi-select labels comma-separated (the SDK's AskUserQuestionOutput). */
export const CLAUDE_QUESTION_TOOL = 'AskUserQuestion';

export interface ClaudeQuestion {
  question: string;
  header: string;
  multiSelect: boolean;
  options: Array<{ label: string; description?: string }>;
}

const text = (value: unknown, max: number): value is string => typeof value === 'string'
  && !!value.trim() && value.length <= max && !value.includes('\0');

/** Null means malformed input (deny). Answers are keyed by question text and
 *  matched by option label, so both must be unique. */
export function parseClaudeQuestions(input: Record<string, unknown>): ClaudeQuestion[] | null {
  const raw = input.questions;
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > 8) return null;
  const questions: ClaudeQuestion[] = [];
  for (const item of raw as unknown[]) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return null;
    const value = item as Record<string, unknown>;
    if (!text(value.question, 2000) || !Array.isArray(value.options)
      || value.options.length === 0 || value.options.length > 16
      || value.multiSelect !== undefined && typeof value.multiSelect !== 'boolean'
      || questions.some(existing => existing.question === value.question)) return null;
    const options: ClaudeQuestion['options'] = [];
    for (const option of value.options as unknown[]) {
      if (!option || typeof option !== 'object' || Array.isArray(option)) return null;
      const { label, description } = option as Record<string, unknown>;
      if (!text(label, 200) || options.some(existing => existing.label === label)) return null;
      options.push({ label, ...(text(description, 2000) ? { description } : {}) });
    }
    questions.push({ question: value.question, header: text(value.header, 200) ? value.header : '',
      multiSelect: value.multiSelect === true, options });
  }
  return questions;
}

/** The same form ask the Prokop question tool sends; option values are the labels. */
export function claudeQuestionAsk(questions: ClaudeQuestion[]): FormQuestion & { target: 'human' } {
  const headers = [...new Set(questions.map(item => item.header).filter(Boolean))];
  return {
    target: 'human',
    type: 'form',
    question: headers.length ? headers.join(', ') : questions.length > 1 ? 'Claude has questions' : 'Claude has a question',
    questions: questions.map(item => {
      const options = item.options.map(option => ({ label: option.label, value: option.label,
        ...(option.description ? { description: option.description } : {}) }));
      return item.multiSelect
        ? { type: 'multi_select' as const, question: item.question, options, min: 1 }
        : { type: 'single_select' as const, question: item.question, options };
    }),
  };
}

/** Null means the response does not answer every question with offered labels. */
export function claudeQuestionAnswers(questions: ClaudeQuestion[], response: unknown): Record<string, string> | null {
  if (!response || typeof response !== 'object' || Array.isArray(response)) return null;
  const { type, answers } = response as Record<string, unknown>;
  if (type !== 'form' || !Array.isArray(answers) || answers.length !== questions.length) return null;
  const result: Record<string, string> = {};
  for (const [index, item] of questions.entries()) {
    const entry = answers[index] as Record<string, unknown> | null | undefined;
    const answer = entry && typeof entry === 'object' ? entry.answer : undefined;
    const labels = new Set(item.options.map(option => option.label));
    if (item.multiSelect) {
      if (!Array.isArray(answer) || answer.length === 0 || new Set(answer).size !== answer.length
        || !answer.every(value => typeof value === 'string' && labels.has(value))) return null;
      result[item.question] = answer.join(', ');
    } else {
      if (typeof answer !== 'string' || !labels.has(answer)) return null;
      result[item.question] = answer;
    }
  }
  return result;
}
