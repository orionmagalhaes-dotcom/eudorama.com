import path from 'path';

type ProxyConfig = { server: string; username?: string; password?: string } | null;

const envFlag = (value: string | undefined): boolean => /^(1|true|yes|sim)$/i.test(String(value || '').trim());

export const createVikiPatchrightContext = async (
  chromium: any,
  devices: any,
  proxy: ProxyConfig
): Promise<{ browser: any; context: any; profileDir: string; headless: boolean }> => {
  const requestedProfileDir = process.env.VIKI_PATCHRIGHT_PROFILE_DIR;
  const profileDir = path.resolve(requestedProfileDir || path.join('artifacts', 'viki-patchright-profile'));
  const usePersistentProfile = Boolean(requestedProfileDir) || envFlag(process.env.VIKI_PATCHRIGHT_PERSISTENT_PROFILE);
  const headless = !envFlag(process.env.VIKI_PATCHRIGHT_HEADFUL || process.env.VIKI_PATCHRIGHT_HEADED);
  const channel = process.env.VIKI_PATCHRIGHT_CHANNEL || undefined;
  const device = devices?.['Pixel 7'] || {};
  const options = {
    ...device,
    headless,
    ...(channel ? { channel } : {}),
    ...(proxy ? { proxy } : {})
  };

  if (usePersistentProfile && typeof chromium.launchPersistentContext === 'function') {
    const context = await chromium.launchPersistentContext(profileDir, options);
    return {
      browser: { close: () => context.close() },
      context,
      profileDir,
      headless
    };
  }

  const browser = await chromium.launch({
    headless,
    ...(channel ? { channel } : {}),
    ...(proxy ? { proxy } : {})
  });
  const context = await browser.newContext(device);
  return { browser, context, profileDir, headless };
};
