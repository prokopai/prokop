/**
 * The same agent across two projects. In linkshelf it was told once not to
 * mock Date and saved that to its own memory. The clip switches to invoicer,
 * asks for tests, and the agent finds that conversation and applies it.
 */
import type { Page } from 'playwright-core';
import { sendPrompt, stageStory, ScreenRecorder, type Clip } from '../clip';
import { openWorkspace } from '../scene';
import { DATE_PREFERENCE_READY } from '../world/date-preference';
import { TEST_INVOICES_READY, testInvoices } from '../world/test-invoices';

async function switchWorkspace(page: Page, name: string): Promise<void> {
  await page.getByRole('combobox', { name: 'Select workspace' }).click();
  await page.getByRole('option', { name }).click();
}

export const memoryClip: Clip = {
  name: 'memory',
  live: ['testInvoices'],
  async record(ctx, theme, framesDir) {
    const preferenceId = ctx.world.sessions.datePreference;
    if (!preferenceId) throw new Error('The memory clip needs the date preference session in the world');
    // Opened from the invoicer sidebar after switching workspaces, like a user would.
    await stageStory(ctx, testInvoices);

    const page = await openWorkspace(ctx, theme, {
      columns: [[preferenceId]],
      readyTexts: [DATE_PREFERENCE_READY],
    });
    const recorder = await ScreenRecorder.start(page, framesDir);
    // Time to read the preference and that it went into the agent's memory.
    await page.waitForTimeout(3000);

    await switchWorkspace(page, 'invoicer');
    await page.getByText(testInvoices.title).first().click();
    await page.waitForTimeout(800);
    await sendPrompt(page, testInvoices.prompt);

    await page.getByText(TEST_INVOICES_READY).first().waitFor({ timeout: 60_000 });
    await page.waitForTimeout(3000);
    return { page, recorder };
  },
};
