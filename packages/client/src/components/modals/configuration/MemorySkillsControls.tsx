import { useId, type ReactElement } from 'react';
import { SettingsRow } from '@/components/ui/settings-row';
import { Switch } from '@/components/ui/switch';

interface MemorySkillsControlsProps {
  scope: 'workspace' | 'agent';
  memoryEnabled: boolean;
  skillsEnabled: boolean;
  onChangeMemory: (enabled: boolean) => void;
  onChangeSkills: (enabled: boolean) => void;
  /** Indents the rows when they sit under a disclosure. */
  className?: string;
}

/** The two capability switches, as rows, for a workspace or an agent. */
export function MemorySkillsControls({
  scope,
  memoryEnabled,
  skillsEnabled,
  onChangeMemory,
  onChangeSkills,
  className,
}: MemorySkillsControlsProps): ReactElement {
  const id = useId();
  return (
    <>
      <SettingsRow
        className={className}
        label="Memory"
        htmlFor={`${id}-memory`}
        description={scope === 'workspace'
          ? 'Use and maintain shared memory for this workspace.'
          : 'Use and maintain personal memory across workspaces.'}
      >
        <Switch id={`${id}-memory`} checked={memoryEnabled} onCheckedChange={onChangeMemory} />
      </SettingsRow>
      <SettingsRow
        className={className}
        label="Skill management"
        htmlFor={`${id}-skills`}
        description={scope === 'workspace'
          ? 'Allow agents to create and update workspace skills.'
          : 'Allow this agent to create and update its personal skills.'}
      >
        <Switch id={`${id}-skills`} checked={skillsEnabled} onCheckedChange={onChangeSkills} />
      </SettingsRow>
    </>
  );
}
