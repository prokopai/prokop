/**
 * The board at capacity: all six linkshelf sessions in their own panes, three
 * columns of two, with the Explorer alongside. Wide, for a panoramic band.
 */
import { openWorkspace, type Scene } from '../scene';
import { DATE_PREFERENCE_READY } from '../world/date-preference';
import { FIX_READY, RATE_LIMIT_READY, SLUGS_READY, STATS_READY } from './ready';

export const board: Scene = {
  name: 'board',
  open: (ctx, theme) => {
    const { fixExpiredLinks, explainSlugs, rateLimit, datePreference, buildScript, statsExpiredFlag } = ctx.world.sessions;
    return openWorkspace(ctx, theme, {
      columns: [[fixExpiredLinks, explainSlugs], [rateLimit, datePreference], [buildScript, statsExpiredFlag]],
      rightActive: 'explorer',
      docks: { right: true },
      readyTexts: [FIX_READY, SLUGS_READY, RATE_LIMIT_READY, DATE_PREFERENCE_READY, 'Allow this command to run?', STATS_READY],
      viewport: { width: 2560, height: 1440 },
    });
  },
};
