/**
 * How-to: get the computer ready for a phone. Settings → Devices, choose how
 * the phone reaches Prokop, and pair it with a QR code. The demo adds a
 * placeholder proxy address instead of opening the network, and masks the
 * host's real Tailscale name. The demo pins PROKOPAI_HOST to loopback; its
 * "Set by PROKOPAI_HOST" note shows the text users normally see.
 */
import { clickOn, ScreenRecorder, showCursor, type Clip } from '../clip';
import { openWorkspace } from '../scene';
import { FIX_READY } from '../scenes/ready';

const ADDRESS = 'https://prokop.example.com';

export const guidePhone: Clip = {
  name: 'guide-phone',
  live: [],
  async record(ctx, theme, framesDir) {
    const page = await openWorkspace(ctx, theme, {
      columns: [[ctx.world.sessions.fixExpiredLinks!]],
      readyTexts: [FIX_READY],
    });
    await showCursor(page);
    await page.evaluate(() => {
      const mask = () => {
        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
        for (let node = walker.nextNode(); node; node = walker.nextNode()) {
          const masked = node.nodeValue
            ?.replace(/[\w-]+\.[\w-]+\.ts\.net/g, 'my-mac.tailnet-name.ts.net')
            .replace(/^Set by PROKOPAI_HOST \(.*\)\.$/, 'Wi-Fi, LAN, and VPNs such as Tailscale or WireGuard.');
          // Only write real changes: the placeholder matches the pattern too.
          if (masked !== undefined && masked !== node.nodeValue) node.nodeValue = masked;
        }
      };
      new MutationObserver(mask).observe(document.body, { childList: true, subtree: true, characterData: true });
    });
    const recorder = await ScreenRecorder.start(page, framesDir);
    await page.waitForTimeout(800);

    await clickOn(page, page.getByRole('button', { name: /^Settings/ }));
    const settings = page.getByRole('dialog');
    await clickOn(page, settings.getByText('Devices', { exact: true }).first());
    await settings.getByText('Remote access').first().waitFor();
    await page.waitForTimeout(2500);

    // How the phone reaches this computer: here, a proxy address.
    const address = settings.getByRole('textbox', { name: 'Address other devices use' });
    await clickOn(page, address);
    await address.pressSequentially(ADDRESS, { delay: 35 });
    await clickOn(page, settings.getByRole('button', { name: 'Add', exact: true }));
    await settings.getByText(ADDRESS, { exact: true }).first().waitFor();
    await page.waitForTimeout(1000);

    // A one-time code, as a QR code and a link.
    await clickOn(page, settings.getByRole('button', { name: 'Pair a device' }));
    const qr = settings.getByRole('img', { name: 'Pairing QR code' });
    await qr.waitFor();
    await qr.scrollIntoViewIfNeeded();
    await page.mouse.move(1150, 820, { steps: 20 });
    await page.waitForTimeout(4000);
    return { page, recorder };
  },
};
