import type { Meta, StoryObj } from '@storybook/react-vite';
import { StructuredResponse } from './StructuredResponse';

/** JSON the model returned under a response format, rendered from its schema. */

const schema = {
  type: 'object',
  title: 'Code review',
  properties: {
    summary: { type: 'string', title: 'Summary' },
    severity: { type: 'string', enum: ['low', 'medium', 'high'], title: 'Severity' },
    approved: { type: 'boolean', title: 'Approved' },
    findings: {
      type: 'array',
      title: 'Findings',
      items: {
        type: 'object',
        properties: {
          file: { type: 'string' },
          line: { type: 'number' },
          message: { type: 'string' },
        },
      },
    },
    metrics: {
      type: 'object',
      title: 'Metrics',
      properties: { filesChanged: { type: 'number' }, coverage: { type: 'number' } },
    },
  },
};

const data = {
  summary: 'The auth refactor keeps the public API and adds types; two edge cases need tests.',
  severity: 'medium',
  approved: false,
  findings: [
    { file: 'src/auth/session.ts', line: 42, message: 'Expired tokens are accepted when exp is missing.' },
    { file: 'src/auth/session.ts', line: 88, message: 'Refresh path logs the raw token.' },
  ],
  metrics: { filesChanged: 7, coverage: 0.84 },
};

const meta: Meta<typeof StructuredResponse> = {
  title: 'Visualizations/StructuredResponse',
  component: StructuredResponse,
  parameters: { layout: 'padded' },
  args: { formatName: 'code-review', data, schema },
};

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const WithoutSchema: Story = {
  args: { schema: undefined },
};

export const Flat: Story = {
  args: { formatName: 'answer', data: { answer: 'Yes', confidence: 0.92, reason: 'All checks pass.' }, schema: undefined },
};

export const DeeplyNested: Story = {
  args: {
    formatName: 'plan',
    schema: undefined,
    data: {
      phases: [
        { name: 'Discovery', tasks: [{ title: 'Read routes', done: true }, { title: 'Map stores', done: false }] },
        { name: 'Build', tasks: [{ title: 'Write stories', done: false, subtasks: [{ title: 'Primitives' }, { title: 'Chat' }] }] },
      ],
      owner: { name: 'Daniel', contact: { email: 'd@example.com' } },
    },
  },
};

export const Empty: Story = {
  args: { formatName: 'empty', data: {}, schema: undefined },
};
