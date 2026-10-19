/**
 * How-to: connect a provider with an API key and make one of its models the
 * default. The key is a placeholder; the demo instance never calls the
 * provider, and the key stays masked on screen.
 */
import { clickOn, ScreenRecorder, showCursor, type Clip } from '../clip';
import { openWorkspace } from '../scene';
import { FIX_READY } from '../scenes/ready';

export const guideConnectProvider: Clip = {
  name: 'guide-connect-provider',
  live: [],
  async record(ctx, theme, framesDir) {
    const page = await openWorkspace(ctx, theme, {
      columns: [[ctx.world.sessions.fixExpiredLinks!]],
      readyTexts: [FIX_READY],
    });
    await showCursor(page);
    // The demo instance's scripted provider does not exist in real installs;
    // keep its row and menu option out of the tutorial.
    await page.evaluate(() => {
      const hide = () => {
        for (const element of document.querySelectorAll<HTMLElement>('[data-slot="collection-row"], [role="option"]')) {
          if (element.textContent?.includes('Sandbox') && element.textContent.includes('Interactive Mock')) element.style.display = 'none';
        }
      };
      new MutationObserver(hide).observe(document.body, { childList: true, subtree: true });
    });
    const recorder = await ScreenRecorder.start(page, framesDir);
    await page.waitForTimeout(800);

    await clickOn(page, page.getByRole('button', { name: /^Settings/ }));
    // Settings opens as a workspace tab.
    const settings = page.locator('[data-settings-server]');
    await clickOn(page, settings.getByText('Providers & models', { exact: true }).first());
    await page.waitForTimeout(800);

    // Open the DeepSeek card and set its API key.
    await clickOn(page, settings.getByRole('button', { name: /DeepSeek/ }).first());
    await clickOn(page, settings.getByRole('button', { name: 'Set Key' }));
    const key = settings.getByPlaceholder('Enter API key…');
    await key.pressSequentially('sk-demo-0000000000000000', { delay: 35 });
    await page.waitForTimeout(300);
    await key.press('Enter');
    await settings.getByRole('button', { name: 'Update' }).first().waitFor();
    await page.waitForTimeout(1000);

    // Make one of its models the default.
    await clickOn(page, settings.getByRole('combobox', { name: 'Default provider' }));
    await clickOn(page, page.getByRole('option', { name: /DeepSeek/ }).first());
    await page.waitForTimeout(600);
    await clickOn(page, settings.getByRole('combobox', { name: 'Default model' }));
    await clickOn(page, page.getByRole('option').first());
    await page.mouse.move(900, 860, { steps: 20 });
    await page.waitForTimeout(2200);
    return { page, recorder };
  },
};
