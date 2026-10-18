import type { Meta, StoryObj } from '@storybook/react-vite';
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
  InputGroupText,
  InputGroupTextarea,
} from './input-group';
import { SearchIcon, XIcon, ArrowRightIcon } from 'lucide-react';

const meta = {
  title: 'Primitives/InputGroup',
  component: InputGroup,
  parameters: {
    layout: 'centered',
  },
} satisfies Meta<typeof InputGroup>;

export default meta;
type Story = StoryObj<typeof meta>;

export const SearchInput: Story = {
  render: () => (
    <InputGroup className="w-80">
      <InputGroupAddon align="inline-start">
        <SearchIcon />
      </InputGroupAddon>
      <InputGroupInput placeholder="Search…" />
    </InputGroup>
  ),
};

export const WithClearButton: Story = {
  render: () => (
    <InputGroup className="w-80">
      <InputGroupAddon align="inline-start">
        <SearchIcon />
      </InputGroupAddon>
      <InputGroupInput placeholder="Search…" />
      <InputGroupAddon align="inline-end">
        <InputGroupButton size="icon-xs">
          <XIcon />
        </InputGroupButton>
      </InputGroupAddon>
    </InputGroup>
  ),
};

export const WithSubmitButton: Story = {
  render: () => (
    <InputGroup className="w-80">
      <InputGroupInput placeholder="Enter URL…" />
      <InputGroupAddon align="inline-end">
        <InputGroupButton size="icon-xs">
          <ArrowRightIcon />
        </InputGroupButton>
      </InputGroupAddon>
    </InputGroup>
  ),
};

export const WithPrefixText: Story = {
  render: () => (
    <InputGroup className="w-80">
      <InputGroupAddon align="inline-start">
        <InputGroupText>https://</InputGroupText>
      </InputGroupAddon>
      <InputGroupInput placeholder="example.com" />
    </InputGroup>
  ),
};

export const WithTopLabel: Story = {
  render: () => (
    <InputGroup className="w-80">
      <InputGroupAddon align="block-start">
        <InputGroupText>Description</InputGroupText>
      </InputGroupAddon>
      <InputGroupTextarea placeholder="Enter description…" className="min-h-20" />
    </InputGroup>
  ),
};

export const Disabled: Story = {
  render: () => (
    <InputGroup className="w-80" aria-disabled>
      <InputGroupAddon align="inline-start">
        <SearchIcon />
      </InputGroupAddon>
      <InputGroupInput disabled placeholder="Disabled search…" />
    </InputGroup>
  ),
};
