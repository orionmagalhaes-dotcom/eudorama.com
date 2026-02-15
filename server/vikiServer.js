import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

if (!process.env.PUPPETEER_CACHE_DIR) {
  // Keep the cache inside the project so the Chrome download is available at runtime on Render.
  process.env.PUPPETEER_CACHE_DIR = path.resolve(__dirname, '..', '.puppeteer-cache');
}

const app = express();

app.use(express.json({ limit: '1mb' }));
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

const OVERALL_TIMEOUT_MS = Number(process.env.VIKI_OVERALL_TIMEOUT_MS || 140000);
const NAV_TIMEOUT_MS = Number(process.env.VIKI_NAV_TIMEOUT_MS || 35000);
const ACTION_TIMEOUT_MS = Number(process.env.VIKI_ACTION_TIMEOUT_MS || 20000);
const NETWORK_IDLE_TIMEOUT_MS = Number(process.env.VIKI_NETWORK_IDLE_TIMEOUT_MS || 12000);
const RESULT_TIMEOUT_MS = Number(process.env.VIKI_RESULT_TIMEOUT_MS || 15000);

const SERVER_VERSION = 'viki-pair-2026-02-15-render-loginfix3';
const TV_CODE_REGEX = '^[a-z0-9]{6}$';

const EMAIL_SELECTORS = [
  'input[type="email"]',
  'input[name="email"]',
  'input[name*="email" i]',
  'input#email',
  'input[id*="email" i]',
  'input[aria-label*="email" i]',
  'input[placeholder*="email" i]',
  'input[placeholder*="e-mail" i]',
  'input[autocomplete="email"]',
  'input[autocomplete="username"]',
  'input[name="username"]',
  'input[id*="username" i]'
];
const PASSWORD_SELECTORS = [
  'input[type="password"]',
  'input[name="password"]',
  'input[name*="password" i]',
  'input#password',
  'input[id*="password" i]',
  'input[aria-label*="password" i]',
  'input[placeholder*="password" i]',
  'input[placeholder*="senha" i]',
  'input[autocomplete="current-password"]'
];
const CODE_SELECTORS = [
  'input[name="code"]',
  'input[name*="code" i]',
  'input#code',
  'input[id*="code" i]',
  'input[aria-label*="code" i]',
  'input[placeholder*="code" i]',
  'input[autocomplete="one-time-code"]',
  'input[maxlength="6"]'
];

let puppeteerPromise;
const getPuppeteer = async () => {
  if (puppeteerPromise) return puppeteerPromise;

  puppeteerPromise = (async () => {
    const [{ default: puppeteer }, { default: StealthPlugin }] = await Promise.all([
      import('puppeteer-extra'),
      import('puppeteer-extra-plugin-stealth')
    ]);

    puppeteer.use(StealthPlugin());
    return puppeteer;
  })();

  return puppeteerPromise;
};

const MAX_CONCURRENT_PAIRS = Number(
  process.env.VIKI_MAX_CONCURRENT || (process.env.NODE_ENV === 'production' ? 1 : 2)
);
let activePairs = 0;

class VikiAutomationError extends Error {
  constructor(message, { statusCode = 500, stage = 'unknown', detail = '' } = {}) {
    super(message);
    this.name = 'VikiAutomationError';
    this.statusCode = statusCode;
    this.stage = stage;
    this.detail = detail;
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const msLeft = (deadlineMs) => deadlineMs - Date.now();
const clampTimeout = (deadlineMs, timeoutMs) => Math.max(1, Math.min(timeoutMs, msLeft(deadlineMs)));

const getContexts = (page) => {
  const frames = page.frames().filter((frame) => frame !== page.mainFrame());
  return [page, ...frames];
};

const getCombinedText = async (page) => {
  const contexts = getContexts(page);
  const chunks = [];

  for (const ctx of contexts) {
    try {
      const text = await ctx.evaluate(() => (document.body?.innerText || '').toLowerCase());
      if (text) chunks.push(text);
    } catch {
      // ignore
    }
  }

  return chunks.join(' ');
};

const isAnySelectorVisibleAnywhere = async (page, selectors) => {
  const contexts = getContexts(page);

  for (const ctx of contexts) {
    for (const selector of selectors) {
      try {
        const handle = await ctx.$(selector);
        if (!handle) continue;
        const box = await handle.boundingBox();
        if (box && box.width > 1 && box.height > 1) return true;
      } catch {
        // ignore
      }
    }
  }

  return false;
};

const getVisibleInputsSnapshot = async (page, limit = 12) => {
  const contexts = getContexts(page);
  const collected = [];

  for (const ctx of contexts) {
    try {
      const items = await ctx.evaluate((lim) => {
        const isVisible = (el) => {
          if (!el) return false;
          const rect = el.getBoundingClientRect?.();
          if (!rect || rect.width < 2 || rect.height < 2) return false;
          const style = window.getComputedStyle?.(el);
          if (!style) return false;
          if (style.display === 'none' || style.visibility === 'hidden') return false;
          const opacity = Number(style.opacity || '1');
          if (Number.isFinite(opacity) && opacity <= 0.05) return false;
          return true;
        };

        const pick = (el) => ({
          type: el.getAttribute('type'),
          name: el.getAttribute('name'),
          id: el.getAttribute('id'),
          placeholder: el.getAttribute('placeholder'),
          ariaLabel: el.getAttribute('aria-label'),
          autocomplete: el.getAttribute('autocomplete')
        });

        return Array.from(document.querySelectorAll('input'))
          .filter(isVisible)
          .slice(0, lim)
          .map(pick);
      }, limit);

      if (Array.isArray(items) && items.length) collected.push(...items);
    } catch {
      // ignore
    }
  }

  const seen = new Set();
  const unique = [];
  for (const item of collected) {
    const key = JSON.stringify(item);
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(item);
    if (unique.length >= limit) break;
  }
  return unique;
};

const getPrimaryContinueStateAnywhere = async (page) => {
  const contexts = getContexts(page);

  for (const ctx of contexts) {
    try {
      const result = await ctx.evaluate(() => {
        const normalize = (value) =>
          String(value || '')
            .toLowerCase()
            .replace(/\s+/g, ' ')
            .trim();

        const isVisible = (el) => {
          if (!el) return false;
          const rect = el.getBoundingClientRect?.();
          if (!rect || rect.width < 2 || rect.height < 2) return false;
          const style = window.getComputedStyle?.(el);
          if (!style) return false;
          if (style.display === 'none' || style.visibility === 'hidden') return false;
          const opacity = Number(style.opacity || '1');
          if (Number.isFinite(opacity) && opacity <= 0.05) return false;
          return true;
        };

        const candidates = Array.from(document.querySelectorAll('button, [role="button"], input[type="submit"]')).filter(isVisible);
        for (const el of candidates) {
          const tag = el.tagName.toLowerCase();
          const rawText =
            tag === 'input'
              ? el.getAttribute('value') || el.getAttribute('aria-label') || ''
              : el.textContent || el.getAttribute('aria-label') || '';
          const label = normalize(rawText);

          // Primary continue only.
          if (label !== 'continue') continue;

          const disabled =
            (tag === 'button' && el.disabled) ||
            el.getAttribute('aria-disabled') === 'true' ||
            el.classList?.contains('disabled');

          return { found: true, disabled: Boolean(disabled), label };
        }

        return { found: false, disabled: false, label: '' };
      });

      if (result) return result;
    } catch {
      // ignore
    }
  }

  return { found: false, disabled: false, label: '' };
};

const getCookieNames = async (page) => {
  try {
    const cookies = await page.cookies();
    const names = cookies.map((c) => c.name).filter(Boolean);
    names.sort();
    return names.slice(0, 25);
  } catch {
    return [];
  }
};

const clickButtonByTextAnywhere = async (page, texts, deadlineMs, timeoutMs = 3000) => {
  const deadline = Math.min(deadlineMs, Date.now() + timeoutMs);

  while (Date.now() < deadline) {
    const contexts = getContexts(page);

    for (const ctx of contexts) {
      try {
        const clicked = await ctx.evaluate((phrases) => {
          const normalize = (value) =>
            String(value || '')
              .toLowerCase()
              .replace(/\s+/g, ' ')
              .trim();

          const isVisible = (el) => {
            if (!el) return false;
            const rect = el.getBoundingClientRect?.();
            if (!rect || rect.width < 2 || rect.height < 2) return false;
            const style = window.getComputedStyle?.(el);
            if (!style) return false;
            if (style.display === 'none' || style.visibility === 'hidden') return false;
            const opacity = Number(style.opacity || '1');
            if (Number.isFinite(opacity) && opacity <= 0.05) return false;
            return true;
          };

          const dialogRoots = Array.from(
            document.querySelectorAll('[role="dialog"], [aria-modal="true"], [data-testid*="modal" i]')
          ).filter(isVisible);

          const scopes = dialogRoots.length ? dialogRoots : [document];

          for (const scope of scopes) {
            const candidates = Array.from(
              scope.querySelectorAll('button, a, [role="button"], input[type="submit"], input[type="button"]')
            ).filter(isVisible);

            for (const candidate of candidates) {
              const tag = candidate.tagName.toLowerCase();
              const rawText =
                tag === 'input'
                  ? candidate.getAttribute('value') || candidate.getAttribute('aria-label') || ''
                  : candidate.textContent || candidate.getAttribute('aria-label') || '';

              const label = normalize(rawText);
              if (!label) continue;

              if (phrases.some((phrase) => label.includes(phrase))) {
                candidate.click();
                return true;
              }
            }
          }

          return false;
        }, texts.map((t) => String(t).toLowerCase()));

        if (clicked) return true;
      } catch {
        // ignore
      }
    }

    await sleep(200);
  }

  return false;
};

const clickButtonByExactTextAnywhere = async (page, exactTexts, deadlineMs, timeoutMs = 3000) => {
  const deadline = Math.min(deadlineMs, Date.now() + timeoutMs);

  while (Date.now() < deadline) {
    const contexts = getContexts(page);

    for (const ctx of contexts) {
      try {
        const clicked = await ctx.evaluate((phrases) => {
          const normalize = (value) =>
            String(value || '')
              .toLowerCase()
              .replace(/\s+/g, ' ')
              .trim();

          const isVisible = (el) => {
            if (!el) return false;
            const rect = el.getBoundingClientRect?.();
            if (!rect || rect.width < 2 || rect.height < 2) return false;
            const style = window.getComputedStyle?.(el);
            if (!style) return false;
            if (style.display === 'none' || style.visibility === 'hidden') return false;
            const opacity = Number(style.opacity || '1');
            if (Number.isFinite(opacity) && opacity <= 0.05) return false;
            return true;
          };

          const dialogRoots = Array.from(
            document.querySelectorAll('[role="dialog"], [aria-modal="true"], [data-testid*="modal" i]')
          ).filter(isVisible);

          const scopes = dialogRoots.length ? dialogRoots : [document];

          for (const scope of scopes) {
            const candidates = Array.from(
              scope.querySelectorAll('button, a, [role="button"], input[type="submit"], input[type="button"]')
            ).filter(isVisible);

            for (const candidate of candidates) {
              const tag = candidate.tagName.toLowerCase();
              const rawText =
                tag === 'input'
                  ? candidate.getAttribute('value') || candidate.getAttribute('aria-label') || ''
                  : candidate.textContent || candidate.getAttribute('aria-label') || '';

              const label = normalize(rawText);
              if (!label) continue;

              if (phrases.includes(label)) {
                candidate.click();
                return true;
              }
            }
          }

          return false;
        }, exactTexts.map((t) => String(t).toLowerCase().trim()));

        if (clicked) return true;
      } catch {
        // ignore
      }
    }

    await sleep(200);
  }

  return false;
};

const clickVikiLoginContinueAnywhere = async (page, deadlineMs) => {
  // Prefer the primary Continue button (not "Continue with ...").
  const exactFirst = await clickButtonByExactTextAnywhere(page, ['continue', 'log in', 'login', 'sign in', 'entrar'], deadlineMs, 4500);
  if (exactFirst) return true;

  // Next best: submit button.
  const submit = await clickFirstSelectorAnywhere(page, ['button[type="submit"]', 'input[type="submit"]'], deadlineMs, 2500);
  if (submit) return true;

  // Last resort: contains match but exclude social-login buttons.
  const clicked = await (async () => {
    const contexts = getContexts(page);
    for (const ctx of contexts) {
      try {
        const did = await ctx.evaluate(() => {
          const normalize = (value) =>
            String(value || '')
              .toLowerCase()
              .replace(/\s+/g, ' ')
              .trim();

          const isVisible = (el) => {
            if (!el) return false;
            const rect = el.getBoundingClientRect?.();
            if (!rect || rect.width < 2 || rect.height < 2) return false;
            const style = window.getComputedStyle?.(el);
            if (!style) return false;
            if (style.display === 'none' || style.visibility === 'hidden') return false;
            const opacity = Number(style.opacity || '1');
            if (Number.isFinite(opacity) && opacity <= 0.05) return false;
            return true;
          };

          const bad = /(continue with|facebook|apple|google|rakuten)/i;
          const candidates = Array.from(document.querySelectorAll('button, [role="button"], input[type="submit"]')).filter(isVisible);

          for (const candidate of candidates) {
            const tag = candidate.tagName.toLowerCase();
            const rawText =
              tag === 'input'
                ? candidate.getAttribute('value') || candidate.getAttribute('aria-label') || ''
                : candidate.textContent || candidate.getAttribute('aria-label') || '';
            const label = normalize(rawText);
            if (!label) continue;
            if (bad.test(label)) continue;

            if (label.includes('continue') || label.includes('login') || label.includes('log in') || label.includes('sign in') || label.includes('entrar')) {
              candidate.click();
              return true;
            }
          }

          return false;
        });

        if (did) return true;
      } catch {
        // ignore
      }
    }

    return false;
  })();

  return clicked;
};

const clickFirstSelectorAnywhere = async (page, selectors, deadlineMs, timeoutMs = 3000) => {
  const deadline = Math.min(deadlineMs, Date.now() + timeoutMs);

  while (Date.now() < deadline) {
    const contexts = getContexts(page);

    for (const ctx of contexts) {
      for (const selector of selectors) {
        try {
          const el = await ctx.waitForSelector(selector, { visible: true, timeout: 800 });
          await el.click();
          return true;
        } catch {
          // ignore
        }
      }
    }

    await sleep(200);
  }

  return false;
};

const fillFirstAnywhere = async (page, selectors, value, deadlineMs, timeoutMs, errorMessage, stage) => {
  const deadline = Math.min(deadlineMs, Date.now() + timeoutMs);

  while (Date.now() < deadline) {
    const contexts = getContexts(page);

    for (const ctx of contexts) {
      for (const selector of selectors) {
        try {
          const el = await ctx.waitForSelector(selector, { timeout: 1200 });
          if (!el) continue;

          const box = await el.boundingBox().catch(() => null);
          if (!box || box.width < 2 || box.height < 2) continue;

          // Try the "human" way first, but on some environments (Render) clicks/types can be flaky.
          try {
            await ctx.evaluate((node) => node.scrollIntoView?.({ block: 'center', inline: 'center' }), el);
            await el.click({ clickCount: 3, delay: 20 });
            await el.press('Backspace').catch(() => {});
            await el.type(value, { delay: 22 });
          } catch {
            // ignore and try JS set below
          }

          // JS-set value as a reliable fallback for controlled inputs.
          await ctx.evaluate(
            (node, nextValue) => {
              const el = node;
              const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
              const prev = el.value;
              if (setter) setter.call(el, String(nextValue));
              else el.value = String(nextValue);

              // Trigger React/Vue listeners.
              el.dispatchEvent(new Event('input', { bubbles: true }));
              el.dispatchEvent(new Event('change', { bubbles: true }));

              // Some forms validate on blur.
              if (prev !== el.value) el.dispatchEvent(new Event('blur', { bubbles: true }));
            },
            el,
            value
          );

          const ok = await ctx
            .evaluate((node, expected) => String(node.value || '') === String(expected), el, value)
            .catch(() => false);

          if (ok) return true;
        } catch {
          // ignore
        }
      }
    }

    await sleep(200);
  }

  const url = page.url();
  const text = await getCombinedText(page).catch(() => '');
  const snippet = sanitizeForLogs(text).slice(0, 260);
  const inputs = await getVisibleInputsSnapshot(page).catch(() => []);
  const inputsJson = inputs.length ? JSON.stringify(inputs).slice(0, 900) : '[]';

  throw new VikiAutomationError(errorMessage, {
    statusCode: 500,
    stage,
    detail: `url=${url} snippet=${snippet} inputs=${inputsJson}`
  });
};

const acceptCookiesIfPresent = async (page, deadlineMs) => {
  await clickButtonByTextAnywhere(page, ['accept all', 'accept', 'agree', 'aceitar tudo', 'aceitar'], deadlineMs, 2500).catch(() => {});
};

const ensureEmailLoginFormVisible = async (page, deadlineMs) => {
  // Some flows show provider selection first (Google/Apple/etc). Prefer Email.
  const hasEmail = await isAnySelectorVisibleAnywhere(page, EMAIL_SELECTORS).catch(() => false);
  const hasPass = await isAnySelectorVisibleAnywhere(page, PASSWORD_SELECTORS).catch(() => false);
  if (hasEmail && hasPass) return;

  await clickButtonByTextAnywhere(
    page,
    ['continue with email', 'continue via email', 'email', 'continuar com email', 'entrar com email', 'e-mail'],
    deadlineMs,
    4500
  ).catch(() => {});
};

const normalizeBrand = (value) => {
  const b = String(value || '').toLowerCase().trim();
  if (b === 'lg') return 'lg';
  if (b === 'androidtv' || b === 'android' || b === 'android_tv' || b === 'android tv' || b === 'google') return 'androidtv';
  return 'samsung';
};

const signInUrlForBrand = (brand) => {
  if (brand === 'lg') return 'https://www.viki.com/web-sign-in?return_to=%2Flgtv';
  if (brand === 'androidtv') return 'https://www.viki.com/web-sign-in?return_to=%2Fandroidtv';
  return 'https://www.viki.com/web-sign-in?return_to=%2Fsamsungtv';
};

const tvPageUrlForBrand = (brand) => {
  if (brand === 'lg') return 'https://www.viki.com/lgtv';
  if (brand === 'androidtv') return 'https://www.viki.com/androidtv';
  return 'https://www.viki.com/samsungtv';
};

// Keep this strict. Generic strings like "try again" can appear in non-error UI.
const LOGIN_ERROR_REGEX = /(invalid|incorrect|wrong password|email or password|unable to sign in|couldn't sign in|senha incorreta|credenciais)/i;
// Avoid false-positives from the common \"protected by reCAPTCHA\" notice shown on many login forms.
const BOT_CHALLENGE_REGEX = /(verify you are human|checking your browser|unusual traffic|access denied|cloudflare|cf-challenge)/i;
const LOGIN_REQUIRED_ON_TV_REGEX =
  /(to proceed, please login|please login to your viki account|log in to your viki account|you are almost done setting up viki on your)/i;

const getVisibleUiErrorsAnywhere = async (page) => {
  const contexts = getContexts(page);
  const all = [];

  for (const ctx of contexts) {
    try {
      const chunk = await ctx.evaluate(() => {
        const isVisible = (el) => {
          if (!el) return false;
          const rect = el.getBoundingClientRect?.();
          if (!rect || rect.width < 2 || rect.height < 2) return false;
          const style = window.getComputedStyle?.(el);
          if (!style) return false;
          if (style.display === 'none' || style.visibility === 'hidden') return false;
          const opacity = Number(style.opacity || '1');
          if (Number.isFinite(opacity) && opacity <= 0.05) return false;
          return true;
        };

        const selectors = [
          '[role=\"alert\"]',
          '[aria-live=\"assertive\"]',
          '[data-testid*=\"error\" i]',
          '[data-testid*=\"toast\" i]',
          '.error',
          '.error-message',
          '.form-error'
        ];

        const nodes = Array.from(document.querySelectorAll(selectors.join(','))).filter(isVisible);
        return nodes.map((n) => (n.innerText || n.textContent || '')).join(' ').toLowerCase();
      });

      if (chunk) all.push(chunk);
    } catch {
      // ignore
    }
  }

  return all.join(' ');
};

const clickRequiredConsentCheckboxesAnywhere = async (page) => {
  const contexts = getContexts(page);
  let clicked = 0;

  for (const ctx of contexts) {
    try {
      const count = await ctx.evaluate(() => {
        const isVisible = (el) => {
          if (!el) return false;
          const rect = el.getBoundingClientRect?.();
          if (!rect || rect.width < 2 || rect.height < 2) return false;
          const style = window.getComputedStyle?.(el);
          if (!style) return false;
          if (style.display === 'none' || style.visibility === 'hidden') return false;
          const opacity = Number(style.opacity || '1');
          if (Number.isFinite(opacity) && opacity <= 0.05) return false;
          return true;
        };

        const getLabelText = (input) => {
          const id = input.getAttribute('id');
          const label = (id && document.querySelector(`label[for=\"${id}\"]`)) || input.closest('label');
          return (label?.innerText || label?.textContent || '').toLowerCase();
        };

        const clickInput = (input) => {
          if (!input) return false;
          const id = input.getAttribute('id');
          const label = (id && document.querySelector(`label[for=\"${id}\"]`)) || input.closest('label');
          (label || input).click();
          return true;
        };

        const looksLikeConsent = (labelText) => {
          if (!labelText) return false;
          return /(i confirm|i agree|terms|privacy|age|18|confirmo|concordo|termos|privacidade|maior|idade)/i.test(labelText);
        };

        let c = 0;
        const inputs = Array.from(document.querySelectorAll('input[type=\"checkbox\"]')).filter(isVisible);
        for (const input of inputs) {
          const required = input.required || input.getAttribute('aria-required') === 'true';
          const labelText = getLabelText(input);
          if (!required && !looksLikeConsent(labelText)) continue;
          if (input.checked) continue;
          if (clickInput(input)) c += 1;
        }

        // Some UIs use custom checkboxes.
        const roleChecks = Array.from(document.querySelectorAll('[role=\"checkbox\"]')).filter(isVisible);
        for (const el of roleChecks) {
          const required = el.getAttribute('aria-required') === 'true';
          const labelText = (el.innerText || el.textContent || '').toLowerCase();
          if (!required && !/(confirm|agree|terms|privacy|age|18|confirmo|concordo|termos|privacidade|maior|idade)/i.test(labelText)) continue;
          const checked = el.getAttribute('aria-checked') === 'true';
          if (checked) continue;
          el.click();
          c += 1;
        }

        return c;
      });

      if (count) clicked += count;
    } catch {
      // ignore
    }
  }

  return clicked;
};

const submitLoginByFormAnywhere = async (page) => {
  const contexts = getContexts(page);

  for (const ctx of contexts) {
    try {
      const clicked = await ctx.evaluate(() => {
        const isVisible = (el) => {
          if (!el) return false;
          const rect = el.getBoundingClientRect?.();
          if (!rect || rect.width < 2 || rect.height < 2) return false;
          const style = window.getComputedStyle?.(el);
          if (!style) return false;
          if (style.display === 'none' || style.visibility === 'hidden') return false;
          const opacity = Number(style.opacity || '1');
          if (Number.isFinite(opacity) && opacity <= 0.05) return false;
          return true;
        };

        const normalize = (value) =>
          String(value || '')
            .toLowerCase()
            .replace(/\s+/g, ' ')
            .trim();

        const findFirstVisible = (selectors) => {
          for (const sel of selectors) {
            const el = Array.from(document.querySelectorAll(sel)).find(isVisible);
            if (el) return el;
          }
          return null;
        };

        const email = findFirstVisible(['input[type=\"email\"]', 'input[name=\"email\"]', 'input#email']);
        const password = findFirstVisible(['input[type=\"password\"]', 'input[name=\"password\"]', 'input#password']);

        const root = password?.closest('form') || email?.closest('form') || document;

        const candidates = Array.from(
          root.querySelectorAll('button, input[type=\"submit\"], input[type=\"button\"], [role=\"button\"]')
        ).filter(isVisible);

        const scoreCandidate = (el) => {
          const tag = el.tagName.toLowerCase();
          const disabled = el.disabled || el.getAttribute('aria-disabled') === 'true';
          if (disabled) return -999;

          const type = tag === 'button' ? (el.getAttribute('type') || '').toLowerCase() : (el.getAttribute('type') || '').toLowerCase();
          const rawText =
            tag === 'input' ? el.getAttribute('value') || el.getAttribute('aria-label') || '' : el.textContent || el.getAttribute('aria-label') || '';
          const text = normalize(rawText);

          // Prefer primary login actions, avoid social providers.
          let score = 0;
          if (type === 'submit') score += 8;
          if (/continue|log in|login|sign in|entrar/.test(text)) score += 6;
          if (/email/.test(text)) score += 2;
          if (/google|facebook|apple|kakao|line/.test(text)) score -= 10;
          if (/create account|sign up|register/.test(text)) score -= 6;
          return score;
        };

        let best = null;
        let bestScore = -999;
        for (const el of candidates) {
          const s = scoreCandidate(el);
          if (s > bestScore) {
            bestScore = s;
            best = el;
          }
        }

        if (!best || bestScore < 1) return false;
        best.click();
        return true;
      });

      if (clicked) return true;
    } catch {
      // ignore
    }
  }

  return false;
};

const getLoginFormSummary = async (page) => {
  const contexts = getContexts(page);
  const summary = {
    url: page.url(),
    emailVisible: 0,
    emailLen: 0,
    passwordVisible: 0,
    passwordLen: 0,
    submitVisible: 0,
    submitDisabled: 0,
    consentCheckboxes: 0,
    consentChecked: 0,
    loginButtonsVisible: 0,
    loginButtonsDisabled: 0
  };

  for (const ctx of contexts) {
    try {
      const part = await ctx.evaluate(() => {
        const isVisible = (el) => {
          if (!el) return false;
          const rect = el.getBoundingClientRect?.();
          if (!rect || rect.width < 2 || rect.height < 2) return false;
          const style = window.getComputedStyle?.(el);
          if (!style) return false;
          if (style.display === 'none' || style.visibility === 'hidden') return false;
          const opacity = Number(style.opacity || '1');
          if (Number.isFinite(opacity) && opacity <= 0.05) return false;
          return true;
        };

        const firstVisible = (selectors) => {
          for (const sel of selectors) {
            const els = Array.from(document.querySelectorAll(sel)).filter(isVisible);
            if (els.length) return els[0];
          }
          return null;
        };

        const email = firstVisible(['input[type=\"email\"]', 'input[name=\"email\"]', 'input#email']);
        const password = firstVisible(['input[type=\"password\"]', 'input[name=\"password\"]', 'input#password']);

        const submitEls = Array.from(document.querySelectorAll('button[type=\"submit\"], input[type=\"submit\"], button')).filter(isVisible);
        const submitDisabled = submitEls.filter((el) => el.disabled || el.getAttribute('aria-disabled') === 'true').length;

        const loginButtons = submitEls.filter((el) => {
          const tag = el.tagName.toLowerCase();
          const rawText =
            tag === 'input' ? el.getAttribute('value') || el.getAttribute('aria-label') || '' : el.textContent || el.getAttribute('aria-label') || '';
          const t = String(rawText || '').toLowerCase();
          return /continue|log in|login|sign in|entrar/.test(t);
        });
        const loginButtonsDisabled = loginButtons.filter((el) => el.disabled || el.getAttribute('aria-disabled') === 'true').length;

        const allChecks = Array.from(document.querySelectorAll('input[type=\"checkbox\"], [role=\"checkbox\"]')).filter(isVisible);
        const checkedCount = allChecks.filter((el) => {
          if (el.tagName.toLowerCase() === 'input') return el.checked;
          return el.getAttribute('aria-checked') === 'true';
        }).length;

        return {
          emailVisible: email ? 1 : 0,
          emailLen: email && typeof email.value === 'string' ? email.value.length : 0,
          passwordVisible: password ? 1 : 0,
          passwordLen: password && typeof password.value === 'string' ? password.value.length : 0,
          submitVisible: submitEls.length,
          submitDisabled,
          consentCheckboxes: allChecks.length,
          consentChecked: checkedCount,
          loginButtonsVisible: loginButtons.length,
          loginButtonsDisabled
        };
      });

      summary.emailVisible = Math.max(summary.emailVisible, part.emailVisible);
      summary.emailLen = Math.max(summary.emailLen, part.emailLen);
      summary.passwordVisible = Math.max(summary.passwordVisible, part.passwordVisible);
      summary.passwordLen = Math.max(summary.passwordLen, part.passwordLen);
      summary.submitVisible = Math.max(summary.submitVisible, part.submitVisible);
      summary.submitDisabled = Math.max(summary.submitDisabled, part.submitDisabled);
      summary.consentCheckboxes = Math.max(summary.consentCheckboxes, part.consentCheckboxes);
      summary.consentChecked = Math.max(summary.consentChecked, part.consentChecked);
      summary.loginButtonsVisible = Math.max(summary.loginButtonsVisible, part.loginButtonsVisible);
      summary.loginButtonsDisabled = Math.max(summary.loginButtonsDisabled, part.loginButtonsDisabled);
    } catch {
      // ignore
    }
  }

  return summary;
};

const waitForCodeOrLoginFailure = async (page, deadlineMs, brand) => {
  const start = Date.now();
  let didTvNavigate = false;

  while (Date.now() < deadlineMs) {
    if (await isAnySelectorVisibleAnywhere(page, CODE_SELECTORS)) {
      return;
    }

    const text = await getCombinedText(page);
    const url = page.url().toLowerCase();

    // If we're on the TV page but still being asked to login, login didn't stick.
    if ((url.includes('/samsungtv') || url.includes('/lgtv') || url.includes('/androidtv')) && LOGIN_REQUIRED_ON_TV_REGEX.test(text)) {
      const snippet = sanitizeForLogs(text).slice(0, 260);
      const cookieNames = await getCookieNames(page);
      throw new VikiAutomationError('Nao foi possivel manter o login no Viki a partir do servidor. Tente novamente.', {
        statusCode: 401,
        stage: 'login',
        detail: `url=${page.url()} snippet=${snippet} cookies=${JSON.stringify(cookieNames)}`
      });
    }

    if (BOT_CHALLENGE_REGEX.test(text) || url.includes('/cdn-cgi/') || url.includes('cf_chl') || url.includes('cf-challenge')) {
      const snippet = sanitizeForLogs(text).slice(0, 260);
      throw new VikiAutomationError('Viki solicitou verificacao anti-bot (captcha). Tente novamente ou use modo manual.', {
        statusCode: 409,
        stage: 'login',
        detail: `url=${page.url()} snippet=${snippet}`
      });
    }

    const uiErrors = await getVisibleUiErrorsAnywhere(page);
    if (uiErrors && LOGIN_ERROR_REGEX.test(uiErrors)) {
      const snippet = sanitizeForLogs(uiErrors).slice(0, 260);
      throw new VikiAutomationError('Email ou senha do Viki invalidos.', {
        statusCode: 401,
        stage: 'login',
        detail: `url=${page.url()} error=${snippet}`
      });
    }

    const onSignInPage = /\/web-sign-in|\/login/i.test(url);
    const emailStillVisible = await isAnySelectorVisibleAnywhere(page, EMAIL_SELECTORS);
    const passwordStillVisible = await isAnySelectorVisibleAnywhere(page, PASSWORD_SELECTORS);

    // If login likely succeeded but the SPA didn't redirect, try opening the TV page once.
    // IMPORTANT: do not do this while the login form is still visible, otherwise we may mask a login failure.
    if (!didTvNavigate && brand && onSignInPage && !emailStillVisible && !passwordStillVisible && Date.now() - start > 5000) {
      didTvNavigate = true;
      await page.goto(tvPageUrlForBrand(brand), { waitUntil: 'domcontentloaded', timeout: clampTimeout(deadlineMs, NAV_TIMEOUT_MS) }).catch(() => {});
      await page.waitForNetworkIdle({ idleTime: 650, timeout: clampTimeout(deadlineMs, NETWORK_IDLE_TIMEOUT_MS) }).catch(() => {});
      await acceptCookiesIfPresent(page, deadlineMs);
    }

    // If we still see the login form after some time, assume login didn't complete.
    if (Date.now() - start > 15000 && emailStillVisible && passwordStillVisible) {
      const snippet = sanitizeForLogs(text).slice(0, 260);
      const debug = await getLoginFormSummary(page).catch(() => null);
      const dbg = debug
        ? ` emailLen=${debug.emailLen} passLen=${debug.passwordLen} submitVisible=${debug.submitVisible} submitDisabled=${debug.submitDisabled} loginBtns=${debug.loginButtonsDisabled}/${debug.loginButtonsVisible} consent=${debug.consentChecked}/${debug.consentCheckboxes}`
        : '';
      throw new VikiAutomationError('Nao foi possivel concluir o login no Viki.', {
        statusCode: 401,
        stage: 'login',
        detail: `url=${page.url()} snippet=${snippet}${dbg}`
      });
    }

    if (Date.now() - start > 12000 && onSignInPage && passwordStillVisible) {
      // Sem mensagem clara, mas nao saiu do login.
      const snippet = sanitizeForLogs(text).slice(0, 260);
      const debug = await getLoginFormSummary(page).catch(() => null);
      const dbg = debug
        ? ` emailLen=${debug.emailLen} passLen=${debug.passwordLen} submitVisible=${debug.submitVisible} submitDisabled=${debug.submitDisabled} loginBtns=${debug.loginButtonsDisabled}/${debug.loginButtonsVisible} consent=${debug.consentChecked}/${debug.consentCheckboxes}`
        : '';
      throw new VikiAutomationError('Nao foi possivel concluir o login no Viki. Verifique email/senha ou se ha verificacao adicional.', {
        statusCode: 401,
        stage: 'login',
        detail: `url=${page.url()} snippet=${snippet}${dbg}`
      });
    }

    await sleep(450);
  }

  const finalText = await getCombinedText(page).catch(() => '');
  const finalSnippet = sanitizeForLogs(finalText).slice(0, 260);
  const finalInputs = await getVisibleInputsSnapshot(page).catch(() => []);
  const finalInputsJson = finalInputs.length ? JSON.stringify(finalInputs).slice(0, 900) : '[]';

  throw new VikiAutomationError('Tempo limite ao aguardar a pagina do codigo.', {
    statusCode: 504,
    stage: 'login_wait',
    detail: `url=${page.url()} snippet=${finalSnippet} inputs=${finalInputsJson}`
  });
};

const sanitizeForLogs = (text) => {
  return String(text || '')
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[email]')
    .replace(/\b\d{6,}\b/g, '[digits]')
    .replace(/\s+/g, ' ')
    .trim();
};

const INVALID_CODE_REGEX = new RegExp(
  [
    'invalid\\s*(activation\\s*)?code',
    'code\\s*(is\\s*)?invalid',
    'code\\s*(is\\s*)?not\\s*valid',
    'activation\\s*code\\s*invalid',
    'please\\s*enter\\s*(a\\s*)?valid\\s*code',
    'no\\s*longer\\s*valid',
    'expired\\s*code',
    'code\\s*has\\s*expired',
    'incorrect\\s*code',
    'try\\s*again',
    'codigo\\s*inva[l|́]ido',
    'c[o|ó]digo\\s*inv[a|á]lido',
    'c[o|ó]digo\\s*incorreto',
    'c[o|ó]digo\\s*expirado',
    'codigo\\s*expirado',
    'expirou'
  ].join('|'),
  'i'
);

const waitForLinkResult = async (page, deadlineMs) => {
  const deadline = Math.min(deadlineMs, Date.now() + RESULT_TIMEOUT_MS);

  while (Date.now() < deadline) {
    const text = await getCombinedText(page);

    if (INVALID_CODE_REGEX.test(text)) {
      throw new VikiAutomationError('Codigo da TV invalido ou expirado.', { statusCode: 422, stage: 'link', detail: `url=${page.url()}` });
    }

    if (/(linked successfully|successfully linked|tv linked|device linked|connected successfully|vinculad[oa]|conectad[oa]|link successful)/i.test(text)) {
      return;
    }

    await sleep(450);
  }

  // Se ainda vemos o input do codigo, consideramos falha de confirmacao.
  const stillHasCode = await isAnySelectorVisibleAnywhere(page, CODE_SELECTORS);
  if (stillHasCode) {
    const text = await getCombinedText(page).catch(() => '');
    const snippet = sanitizeForLogs(text).slice(0, 260);
    throw new VikiAutomationError('Nao foi possivel confirmar a vinculacao da TV.', {
      statusCode: 500,
      stage: 'link_wait',
      detail: `url=${page.url()} snippet=${snippet}`
    });
  }
};

const linkVikiTv = async ({ brand, vikiEmail, vikiPassword, tvCode }) => {
  const deadlineMs = Date.now() + OVERALL_TIMEOUT_MS;
  let stage = 'launch';
  let browser;
  let page;

  const doLoginFromCurrentPage = async () => {
    await acceptCookiesIfPresent(page, deadlineMs);
    await ensureEmailLoginFormVisible(page, deadlineMs);

    stage = 'fill_credentials';
    await fillFirstAnywhere(page, EMAIL_SELECTORS, vikiEmail, deadlineMs, ACTION_TIMEOUT_MS, 'Campo de email nao encontrado no login.', stage);
    await fillFirstAnywhere(page, PASSWORD_SELECTORS, vikiPassword, deadlineMs, ACTION_TIMEOUT_MS, 'Campo de senha nao encontrado no login.', stage);

    stage = 'submit_login';
    const beforeLoginDebug = await getLoginFormSummary(page).catch(() => null);
    await clickRequiredConsentCheckboxesAnywhere(page).catch(() => {});
    const afterConsentDebug = await getLoginFormSummary(page).catch(() => null);

    const continueState = await getPrimaryContinueStateAnywhere(page).catch(() => ({ found: false, disabled: false }));
    if (continueState?.found && continueState?.disabled) {
      const dbg1 = beforeLoginDebug
        ? ` emailLen=${beforeLoginDebug.emailLen} passLen=${beforeLoginDebug.passwordLen} submitVisible=${beforeLoginDebug.submitVisible} submitDisabled=${beforeLoginDebug.submitDisabled} consent=${beforeLoginDebug.consentChecked}/${beforeLoginDebug.consentCheckboxes}`
        : '';
      const dbg2 = afterConsentDebug
        ? ` emailLen=${afterConsentDebug.emailLen} passLen=${afterConsentDebug.passwordLen} submitVisible=${afterConsentDebug.submitVisible} submitDisabled=${afterConsentDebug.submitDisabled} consent=${afterConsentDebug.consentChecked}/${afterConsentDebug.consentCheckboxes}`
        : '';
      throw new VikiAutomationError('O Viki exigiu confirmacao de termos/idade antes de continuar. Tente novamente.', {
        statusCode: 400,
        stage: 'login',
        detail: `url=${page.url()} before=[${dbg1}] after=[${dbg2}]`
      });
    }

    const loginNavigation = page
      .waitForNavigation({ waitUntil: 'domcontentloaded', timeout: clampTimeout(deadlineMs, NAV_TIMEOUT_MS) })
      .catch(() => null);

    const clickedContinue = (await submitLoginByFormAnywhere(page)) || (await clickVikiLoginContinueAnywhere(page, deadlineMs));
    if (!clickedContinue) {
      throw new VikiAutomationError('Botao de continuar/login nao encontrado.', { statusCode: 500, stage });
    }

    await clickFirstSelectorAnywhere(page, PASSWORD_SELECTORS, deadlineMs, 1500).catch(() => {});
    await page.keyboard.press('Enter').catch(() => {});

    await loginNavigation;
    await page.waitForNetworkIdle({ idleTime: 650, timeout: clampTimeout(deadlineMs, NETWORK_IDLE_TIMEOUT_MS) }).catch(() => {});
    await sleep(1500);
  };

  try {
    const puppeteer = await getPuppeteer();
    browser = await puppeteer.launch({
      headless: process.env.VIKI_HEADLESS === 'false' ? false : true,
      // Container-friendly flags (Render/Docker). Keep minimal to reduce side-effects.
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu']
    });

    page = await browser.newPage();
    await page.setViewport({ width: 1366, height: 768 });
    await page.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
    );

    page.setDefaultTimeout(ACTION_TIMEOUT_MS);

    stage = 'open_signin';
    await page.goto(signInUrlForBrand(brand), {
      waitUntil: 'domcontentloaded',
      timeout: clampTimeout(deadlineMs, NAV_TIMEOUT_MS)
    });

    await page.waitForNetworkIdle({ idleTime: 650, timeout: clampTimeout(deadlineMs, NETWORK_IDLE_TIMEOUT_MS) }).catch(() => {});
    await doLoginFromCurrentPage();

    stage = 'wait_code';
    try {
      await waitForCodeOrLoginFailure(page, deadlineMs, brand);
    } catch (e) {
      // Fallback: some accounts only complete login when starting from the TV page (clicking its Log In button).
      if (e instanceof VikiAutomationError && e.stage === 'login') {
        stage = 'open_tv';
        await page.goto(tvPageUrlForBrand(brand), { waitUntil: 'domcontentloaded', timeout: clampTimeout(deadlineMs, NAV_TIMEOUT_MS) });
        await page.waitForNetworkIdle({ idleTime: 650, timeout: clampTimeout(deadlineMs, NETWORK_IDLE_TIMEOUT_MS) }).catch(() => {});
        await acceptCookiesIfPresent(page, deadlineMs);

        // If the code is already visible, proceed.
        const hasCode = await isAnySelectorVisibleAnywhere(page, CODE_SELECTORS).catch(() => false);
        if (!hasCode) {
          stage = 'tv_click_login';
          await clickButtonByTextAnywhere(page, ['log in', 'login', 'sign in', 'entrar'], deadlineMs, 6500).catch(() => {});
          await page.waitForNetworkIdle({ idleTime: 650, timeout: clampTimeout(deadlineMs, NETWORK_IDLE_TIMEOUT_MS) }).catch(() => {});
          await doLoginFromCurrentPage();
          stage = 'wait_code';
          await waitForCodeOrLoginFailure(page, deadlineMs, brand);
        }
      } else {
        throw e;
      }
    }

    stage = 'fill_tv_code';
    await fillFirstAnywhere(page, CODE_SELECTORS, tvCode, deadlineMs, ACTION_TIMEOUT_MS, 'Campo do codigo da TV nao foi encontrado.', stage);

    stage = 'submit_tv_code';
    const clickedConnect =
      (await clickButtonByTextAnywhere(page, ['connect', 'link now', 'link', 'conectar', 'vincular', 'activate', 'ativar'], deadlineMs, 5000)) ||
      (await clickFirstSelectorAnywhere(page, ['button[type="submit"]', 'input[type="submit"]'], deadlineMs, 3000));

    if (!clickedConnect) {
      throw new VikiAutomationError('Botao de conectar/vincular nao encontrado.', { statusCode: 500, stage, detail: `url=${page.url()}` });
    }

    await page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: clampTimeout(deadlineMs, 12000) }).catch(() => null);

    stage = 'link_wait';
    await waitForLinkResult(page, deadlineMs);

    return { success: true };
  } catch (error) {
    if (error instanceof VikiAutomationError) {
      throw error;
    }

    if (error?.name === 'TimeoutError') {
      throw new VikiAutomationError('Tempo limite excedido ao acessar o Viki.', {
        statusCode: 504,
        stage,
        detail: String(error.message || error)
      });
    }

    throw new VikiAutomationError('Falha na automacao de vinculacao com o Viki.', {
      statusCode: 500,
      stage,
      detail: String(error?.message || error)
    });
  } finally {
    if (browser) {
      await browser.close().catch(() => {});
    }
  }
};

app.get('/api/viki/health', (_req, res) => {
  return res.status(200).json({
    ok: true,
    version: SERVER_VERSION,
    tv_code_regex: TV_CODE_REGEX,
    puppeteer_cache_dir: process.env.PUPPETEER_CACHE_DIR || null,
    max_concurrent_pairs: MAX_CONCURRENT_PAIRS,
    active_pairs: activePairs
  });
});

app.post('/api/viki/pair', async (req, res) => {
  let acquiredSlot = false;
  try {
    const vikiEmail = String(req.body?.viki_email || req.body?.email || '').trim();
    const vikiPassword = String(req.body?.viki_password || req.body?.password || '').trim();
    const tvCode = String(req.body?.tv_code || req.body?.code || '').trim().toLowerCase();
    const brand = normalizeBrand(req.body?.tv_brand || req.body?.brand || req.body?.tvBrand || 'samsung');

    if (!vikiEmail || !vikiPassword || !tvCode) {
      return res.status(400).json({ error: 'Campos obrigatorios: viki_email, viki_password, tv_code.' });
    }

    if (!/^[a-z0-9]{6}$/.test(tvCode)) {
      return res.status(400).json({ error: 'tv_code deve conter exatamente 6 caracteres: letras minusculas (a-z) e numeros (0-9).' });
    }

    if (activePairs >= MAX_CONCURRENT_PAIRS) {
      res.setHeader('Retry-After', '10');
      return res.status(429).json({
        error: 'Servidor ocupado. Tente novamente em alguns segundos.',
        stage: 'busy',
        detail: `active=${activePairs} max=${MAX_CONCURRENT_PAIRS}`
      });
    }

    activePairs += 1;
    acquiredSlot = true;

    const result = await linkVikiTv({ brand, vikiEmail, vikiPassword, tvCode });
    return res.status(200).json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Erro inesperado ao vincular TV.';
    const statusCode = Number(error?.statusCode) || 500;
    const stage = String(error?.stage || 'unknown');
    const detail = error?.detail ? String(error.detail) : undefined;
    return res.status(statusCode).json({ error: message, stage, detail });
  } finally {
    if (acquiredSlot) {
      activePairs = Math.max(0, activePairs - 1);
    }
  }
});

// In production (Render), serve the built SPA from dist/ on the same origin,
// so the frontend can call /api/viki/* without CORS issues.
if (process.env.NODE_ENV === 'production') {
  const distDir = path.resolve(__dirname, '..', 'dist');
  app.use(express.static(distDir));

  // SPA fallback (do not swallow API routes).
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api/')) return next();
    return res.sendFile(path.join(distDir, 'index.html'));
  });
}

const port = Number(process.env.PORT || process.env.VIKI_SERVER_PORT || 4010);
app.listen(port, '0.0.0.0', () => {
  console.log(`Viki server running on port ${port}`);
});
