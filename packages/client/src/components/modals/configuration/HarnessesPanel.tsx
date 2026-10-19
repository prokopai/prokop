import type { ProkopaiClient, SessionHarness } from '@prokopai/sdk';
import { useHarnessesQuery, useSetHarnessEnabled, isHarnessEnabled } from '@/hooks/queries';
import { Badge } from '@/components/ui/badge';
import { SettingsGroup } from '@/components/ui/settings-group';
import { SettingsRow } from '@/components/ui/settings-row';
import { Switch } from '@/components/ui/switch';
import { AnthropicMark, OpenAIMark, ProkopMark } from '@/components/branding/BrandMarks';
import { LoadingState } from '@/components/shared/States';

interface HarnessesPanelProps {
  sdkClient: ProkopaiClient | null;
}

const HARNESS_META: Record<SessionHarness, { name: string; Mark: typeof ProkopMark; external: boolean }> = {
  prokop: { name: 'Prokop', Mark: ProkopMark, external: false },
  'codex-cli': { name: 'Codex CLI', Mark: OpenAIMark, external: true },
  'claude-cli': { name: 'Claude CLI', Mark: AnthropicMark, external: true },
};

export function HarnessesPanel({ sdkClient }: HarnessesPanelProps) {
  const { data, isLoading } = useHarnessesQuery(sdkClient);
  const setEnabled = useSetHarnessEnabled(sdkClient);
  const harnesses = data?.harnesses;

  if (isLoading) {
    return <LoadingState />;
  }

  return (
    <div className="flex flex-col gap-4 p-3 sm:p-4">
      <SettingsGroup
        label="Harnesses"
        description="External harnesses run through their own CLI on this host. Disabling one hides it from new sessions and scheduled jobs; existing sessions keep running."
      >
        {(harnesses ?? []).map((harness) => {
          const meta = HARNESS_META[harness.id];
          if (!meta) return null;
          const enabled = isHarnessEnabled(harness);
          const badge = !meta.external ? <Badge variant="outline">Built-in</Badge>
            : !harness.available ? <Badge variant="outline">Not installed</Badge>
              : harness.version ? <Badge variant="secondary">CLI {harness.version}</Badge> : null;
          const description = !meta.external ? 'The built-in runtime with providers, tools, and learning.'
            : !harness.available ? `Install the CLI on this host to use ${meta.name} sessions.` : undefined;
          return (
            <SettingsRow
              key={harness.id}
              htmlFor={meta.external ? `harness-${harness.id}` : undefined}
              label={<span className="flex items-center gap-2"><meta.Mark className="size-3.5 shrink-0 text-muted-foreground" />{meta.name}{badge}</span>}
              description={description}
            >
              {meta.external && (
                <Switch
                  id={`harness-${harness.id}`}
                  aria-label={`Enable ${meta.name}`}
                  checked={enabled}
                  disabled={setEnabled.isPending}
                  onCheckedChange={(checked) => setEnabled.mutate({ harness: harness.id, enabled: checked })}
                />
              )}
            </SettingsRow>
          );
        })}
      </SettingsGroup>
    </div>
  );
}
