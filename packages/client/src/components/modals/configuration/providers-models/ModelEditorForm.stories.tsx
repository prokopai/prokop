import type { Meta, StoryObj } from '@storybook/react-vite';
import { fn } from 'storybook/test';
import { ModelEditorForm } from './ModelEditorForm';
import { createFakeSdkClient } from '../../../../../.storybook/harness';
import { createModelList } from '../../../../../.storybook/mocks/mockProvider';

/** Create or edit a catalog model: id, name, context window, variants JSON, capabilities. */

const model = createModelList()[0]!;

const meta = {
  title: 'Settings/ModelEditorForm',
  component: ModelEditorForm,
  parameters: { layout: 'padded' },
  args: { sdkClient: createFakeSdkClient(), providerId: model.providerId, providerName: model.providerName, model: null, onDone: fn() },
  decorators: [(Story) => <div className="w-[36rem] rounded-xl border bg-card p-3"><Story /></div>],
} satisfies Meta<typeof ModelEditorForm>;

export default meta;
type Story = StoryObj<typeof meta>;

export const NewModel: Story = {};

export const EditModel: Story = {
  args: { model },
};

export const EditWithVariants: Story = {
  args: { model: { ...model, variants: { low: { providerOptions: { reasoning: { effort: 'low' } } }, high: { providerOptions: { reasoning: { effort: 'high' } } } } } },
};

export const SaveFails: Story = {
  args: { model, sdkClient: createFakeSdkClient({ http: { config: { models: { updateModel: async () => { throw new Error('Model id already exists'); } } } } }) },
};
