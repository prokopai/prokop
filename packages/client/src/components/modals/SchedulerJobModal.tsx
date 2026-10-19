import { ErrorState } from '@/components/shared/States';
import { useState, useEffect, useCallback } from 'react';
import type { ProkopaiClient, ScheduledJob, ScheduleKind, ScheduleConfig, PermissionMode } from '@prokopai/sdk';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { FormGrid, SettingsRow } from '@/components/ui/settings-row';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';
import { useServerDataStore } from '@/stores/serverDataStore';
import {
  useCreateScheduledJob,
  useUpdateScheduledJob,
} from '@/hooks/queries';
import { formatLastRun } from '@/utils/scheduleCountdown';
import { Loader2 } from 'lucide-react';

interface SchedulerJobModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sdkClient: ProkopaiClient | null;
  workspaceId: string | null;
  editingJob: ScheduledJob | null;
}

const DAYS = [
  { value: 1, label: 'Mon' },
  { value: 2, label: 'Tue' },
  { value: 3, label: 'Wed' },
  { value: 4, label: 'Thu' },
  { value: 5, label: 'Fri' },
  { value: 6, label: 'Sat' },
  { value: 0, label: 'Sun' },
];

const SCHEDULE_KINDS: { value: ScheduleKind; label: string }[] = [
  { value: 'interval', label: 'Interval' },
  { value: 'daily', label: 'Daily' },
  { value: 'weekly', label: 'Weekly' },
  { value: 'once', label: 'Once' },
];

export function SchedulerJobModal({
  open,
  onOpenChange,
  sdkClient,
  workspaceId,
  editingJob,
}: SchedulerJobModalProps) {
  const preconfigs = useServerDataStore((s) => s.preconfigs);

  const [name, setName] = useState('');
  const [prompt, setPrompt] = useState('');
  const [scheduleKind, setScheduleKind] = useState<ScheduleKind>('interval');
  const [intervalMinutes, setIntervalMinutes] = useState(120);
  const [dailyTime, setDailyTime] = useState('09:00');
  const [weeklyDays, setWeeklyDays] = useState<number[]>([1, 2, 3, 4, 5]);
  const [weeklyTime, setWeeklyTime] = useState('09:00');
  const [onceDate, setOnceDate] = useState('');
  const [onceTime, setOnceTime] = useState('');
  const [repeatLimit, setRepeatLimit] = useState<string>('');
  const [preconfigId, setPreconfigId] = useState<string>('__default__');
  const [reuseSession, setReuseSession] = useState(false);
  const [includeHistory, setIncludeHistory] = useState(false);
  const [permissionMode, setPermissionMode] = useState<PermissionMode | null>(null);
  const [notificationsEnabled, setNotificationsEnabled] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const createMutation = useCreateScheduledJob(sdkClient, workspaceId);
  const updateMutation = useUpdateScheduledJob(sdkClient, workspaceId);

  useEffect(() => {
    if (!open) return;
    setError(null);
    if (editingJob) {
      setName(editingJob.name);
      setPrompt(editingJob.prompt);
      setScheduleKind(editingJob.scheduleKind);
      const config = editingJob.scheduleConfig;
      if (config.type === 'interval') setIntervalMinutes(config.intervalMinutes);
      if (config.type === 'daily') setDailyTime(config.time);
      if (config.type === 'weekly') {
        setWeeklyDays(config.days);
        setWeeklyTime(config.time);
      }
      if (config.type === 'once') {
        const d = new Date(config.runAt);
        setOnceDate(d.toISOString().slice(0, 10));
        setOnceTime(d.toTimeString().slice(0, 5));
      }
      setRepeatLimit(editingJob.repeatLimit !== null ? String(editingJob.repeatLimit) : '');
      setPreconfigId(editingJob.preconfigId ?? '__default__');
      setReuseSession(editingJob.reuseSession);
      setIncludeHistory(editingJob.includeHistory);
      setPermissionMode(editingJob.permissionMode ?? null);
      setNotificationsEnabled(editingJob.notificationsEnabled === true);
    } else {
      setName('');
      setPrompt('');
      setScheduleKind('interval');
      setIntervalMinutes(120);
      setDailyTime('09:00');
      setWeeklyDays([1, 2, 3, 4, 5]);
      setWeeklyTime('09:00');
      setOnceDate('');
      setOnceTime('');
      setRepeatLimit('');
      setPreconfigId('__default__');
      setReuseSession(false);
      setIncludeHistory(false);
      setPermissionMode(null);
      setNotificationsEnabled(false);
    }
  }, [open, editingJob]);

  const buildScheduleConfig = useCallback((): ScheduleConfig => {
    switch (scheduleKind) {
      case 'interval':
        return { type: 'interval', intervalMinutes };
      case 'daily':
        return { type: 'daily', time: dailyTime };
      case 'weekly':
        return { type: 'weekly', days: weeklyDays, time: weeklyTime };
      case 'once': {
        const dateStr = onceDate || new Date().toISOString().slice(0, 10);
        const timeStr = onceTime || '12:00';
        return { type: 'once', runAt: new Date(`${dateStr}T${timeStr}`).toISOString() };
      }
    }
  }, [scheduleKind, intervalMinutes, dailyTime, weeklyDays, weeklyTime, onceDate, onceTime]);

  const handleSave = useCallback(async () => {
    if (!workspaceId || !name.trim() || !prompt.trim()) return;

    const config = buildScheduleConfig();
    const limitValue = repeatLimit.trim() === '' ? null : parseInt(repeatLimit, 10);
    const preconfigValue = preconfigId === '__default__' ? null : preconfigId;

    setError(null);
    try {
      if (editingJob) {
        await updateMutation.mutateAsync({
          jobId: editingJob.id,
          updates: {
            name: name.trim(),
            prompt: prompt.trim(),
            scheduleKind,
            scheduleConfig: config,
            repeatLimit: limitValue,
            preconfigId: preconfigValue,
            reuseSession,
            includeHistory,
            permissionMode,
            notificationsEnabled,
          },
        });
      } else {
        await createMutation.mutateAsync({
          name: name.trim(),
          prompt: prompt.trim(),
          scheduleKind,
          scheduleConfig: config,
          repeatLimit: limitValue,
          preconfigId: preconfigValue,
          reuseSession,
          includeHistory,
          permissionMode,
          notificationsEnabled,
        });
      }
      onOpenChange(false);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to save scheduled job');
    }
  }, [workspaceId, name, prompt, buildScheduleConfig, repeatLimit, preconfigId, editingJob, scheduleKind, createMutation, updateMutation, onOpenChange, permissionMode, notificationsEnabled, reuseSession, includeHistory]);

  const toggleDay = (day: number) => {
    setWeeklyDays(prev =>
      prev.includes(day) ? prev.filter(d => d !== day) : [...prev, day].sort(),
    );
  };

  const isSaving = createMutation.isPending || updateMutation.isPending;

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => { if (!isSaving) onOpenChange(nextOpen); }}>
      <DialogContent className="flex flex-col overflow-hidden gap-4 max-w-[calc(100vw-1rem)] sm:max-w-xl sm:max-h-[85vh]">
        <DialogHeader className="shrink-0">
          <DialogTitle>{editingJob ? 'Edit scheduled job' : 'New scheduled job'}</DialogTitle>
        </DialogHeader>

        <FormGrid className="dialog-scrollbar min-h-0 flex-1 overflow-y-auto overscroll-contain">
          <SettingsRow label="Name" htmlFor="job-name">
            <Input
              id="job-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Daily summary"
              className="sm:w-64"
            />
          </SettingsRow>

          <SettingsRow label="Prompt" htmlFor="job-prompt" description="Each run starts a session with this message." stacked>
            <Textarea
              id="job-prompt"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="Check the build status and summarize any failures"
              rows={4}
            />
          </SettingsRow>

          <SettingsRow label="Schedule">
            <SegmentedControl label="Schedule" options={SCHEDULE_KINDS} value={scheduleKind} onChange={setScheduleKind} />
          </SettingsRow>

          {scheduleKind === 'interval' && (
            <SettingsRow label="Run every" htmlFor="job-interval">
              <span className="flex items-center gap-2 text-sm text-muted-foreground">
                <Input
                  id="job-interval"
                  type="number"
                  min={1}
                  value={intervalMinutes}
                  onChange={(e) => setIntervalMinutes(Math.max(1, parseInt(e.target.value) || 1))}
                  className="w-24"
                />
                minutes
              </span>
            </SettingsRow>
          )}

          {scheduleKind === 'daily' && (
            <SettingsRow label="Run at" htmlFor="job-daily-time">
              <Input id="job-daily-time" type="time" value={dailyTime} onChange={(e) => setDailyTime(e.target.value)} className="w-32" />
            </SettingsRow>
          )}

          {scheduleKind === 'weekly' && (
            <>
              <SettingsRow label="Run on">
                <span className="flex flex-wrap gap-1" role="group" aria-label="Days of the week">
                  {DAYS.map(day => {
                    const selected = weeklyDays.includes(day.value);
                    return (
                      <button
                        key={day.value}
                        type="button"
                        aria-pressed={selected}
                        onClick={() => toggleDay(day.value)}
                        className={cn(
                          'h-6 rounded-sm border px-2 text-xs transition-colors',
                          selected
                            ? 'border-highlight bg-highlight/10 text-foreground'
                            : 'border-border/50 text-muted-foreground hover:bg-muted hover:text-foreground',
                        )}
                      >
                        {day.label}
                      </button>
                    );
                  })}
                </span>
              </SettingsRow>
              <SettingsRow label="At" htmlFor="job-weekly-time">
                <Input id="job-weekly-time" type="time" value={weeklyTime} onChange={(e) => setWeeklyTime(e.target.value)} className="w-32" />
              </SettingsRow>
            </>
          )}

          {scheduleKind === 'once' && (
            <>
              <SettingsRow label="Date" htmlFor="job-once-date">
                <Input id="job-once-date" type="date" value={onceDate} onChange={(e) => setOnceDate(e.target.value)} className="w-40" />
              </SettingsRow>
              <SettingsRow label="Time" htmlFor="job-once-time">
                <Input id="job-once-time" type="time" value={onceTime} onChange={(e) => setOnceTime(e.target.value)} className="w-32" />
              </SettingsRow>
            </>
          )}

          <SettingsRow label="Repeat limit" htmlFor="job-repeat" description="Empty runs forever.">
            <Input
              id="job-repeat"
              type="number"
              min={1}
              value={repeatLimit}
              onChange={(e) => setRepeatLimit(e.target.value)}
              placeholder="Infinite"
              className="w-28"
            />
          </SettingsRow>

          <SettingsRow label="Agent" htmlFor="job-preconfig">
            <Select value={preconfigId} onValueChange={setPreconfigId}>
              <SelectTrigger id="job-preconfig" className="w-48">
                <SelectValue placeholder="Default" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__default__">Default</SelectItem>
                {preconfigs.map(pc => (
                  <SelectItem key={pc.id} value={pc.id}>{pc.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </SettingsRow>

          <SettingsRow label="Reuse the same session" htmlFor="job-reuse-session" description="Every run continues one session instead of starting a new one.">
            <Switch
              id="job-reuse-session"
              checked={reuseSession}
              onCheckedChange={setReuseSession}
            />
          </SettingsRow>

          {reuseSession && (
            <SettingsRow label="Include previous runs" htmlFor="job-include-history" description="The agent sees the earlier runs as context.">
              <Switch
                id="job-include-history"
                checked={includeHistory}
                onCheckedChange={setIncludeHistory}
              />
            </SettingsRow>
          )}

          <SettingsRow label="Send notifications" htmlFor="job-notifications" description="Completion, failure and permission requests. Each device's notification preferences still apply.">
            <Switch
              id="job-notifications"
              checked={notificationsEnabled}
              onCheckedChange={setNotificationsEnabled}
            />
          </SettingsRow>

          <SettingsRow label="Permission mode" description="Which permissions run automatically in sessions this job creates.">
            <Select
              value={permissionMode ?? '__workspace__'}
              onValueChange={(v) => setPermissionMode(v === '__workspace__' ? null : v as PermissionMode)}
            >
              <SelectTrigger className="w-48" aria-label="Permission mode">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__workspace__">Use workspace default</SelectItem>
                <SelectItem value="standard">Standard</SelectItem>
                <SelectItem value="extended">Extended</SelectItem>
                <SelectItem value="full">Full access</SelectItem>
              </SelectContent>
            </Select>
          </SettingsRow>

          {editingJob && (
            <>
              <SettingsRow label="Runs">
                <span className="text-sm tabular-nums">{editingJob.runCount}{editingJob.repeatLimit !== null ? ` / ${editingJob.repeatLimit}` : ''}</span>
              </SettingsRow>
              <SettingsRow label="Last run" description={editingJob.lastError ? <span className="text-error">{editingJob.lastError}</span> : undefined}>
                <span className="text-sm">{formatLastRun(editingJob)}</span>
              </SettingsRow>
            </>
          )}
        </FormGrid>

        {error && (
          <ErrorState className="shrink-0">{error}</ErrorState>
        )}

        <DialogFooter className="shrink-0">
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={isSaving}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={!name.trim() || !prompt.trim() || isSaving}>
            {isSaving && <Loader2 data-icon="inline-start" className="animate-spin" />}
            {isSaving ? 'Saving...' : editingJob ? 'Save changes' : 'Create job'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
