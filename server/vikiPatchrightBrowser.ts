import path from 'path';

type ProxyConfig = { server: string; username?: string; password?: string } | null;

const envFlag = (value: string | undefined): boolean => /^(1|true|yes|sim)$/i.test(String(value || '').trim());

const sanitizeEmailForPath = (email?: string): string => {
  if (!email || typeof email !== 'string') return 'default-profile';
  return email.toLowerCase().trim().replace(/[^a-z0-9]/g, '_');
};

export const createVikiPatchrightContext = async (
  chromium: any,
  devices: any,
  proxy: ProxyConfig,
  email?: string
): Promise<{ browser: any; context: any; profileDir: string; headless: boolean }> => {
  const baseProfilesDir = process.env.VIKI_PATCHRIGHT_PROFILES_DIR || path.join('artifacts', 'viki-profiles');
  const profileSubdir = sanitizeEmailForPath(email);
  const profileDir = path.resolve(path.join(baseProfilesDir, profileSubdir));
  const usePersistentProfile = envFlag(process.env.VIKI_PATCHRIGHT_PERSISTENT_PROFILE ?? 'true');
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
