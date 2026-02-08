/**
 * session-manager.ts — Browserbase session lifecycle, CDP connection, navigation
 *
 * This module IS the provider boundary. All Browserbase SDK and CDP calls
 * are wrapped in well-named functions. If we ever swap cloud browser providers,
 * this is the one file to rewrite.
 */

import Browserbase from '@browserbasehq/sdk';
import { chromium, type Browser, type Page, type BrowserContext } from 'playwright-core';

// ── Types ────────────────────────────────────────────────────

export interface SessionConfig {
  apiKey: string;
  projectId: string;
}

export interface SessionInfo {
  sessionId: string;
  connectUrl: string;
  liveViewUrl: string;
}

export interface ActiveSession {
  info: SessionInfo;
  browser: Browser;
  context: BrowserContext;
  page: Page;
  viewport?: { width: number; height: number };
  mobile?: boolean;
}

// ── State ────────────────────────────────────────────────────

let config: SessionConfig | null = null;
let bb: Browserbase | null = null;
let activeSession: ActiveSession | null = null;

// ── Init ─────────────────────────────────────────────────────

export function init(cfg: SessionConfig): void {
  if (!cfg.apiKey) throw new Error('Browserbase API key is required');
  if (!cfg.projectId) throw new Error('Browserbase project ID is required');
  config = cfg;
  bb = new Browserbase({ apiKey: cfg.apiKey });
}

function requireInit(): { bb: Browserbase; config: SessionConfig } {
  if (!bb || !config) throw new Error('Session manager not initialized — call init() first');
  return { bb, config };
}

// ── Session Lifecycle ────────────────────────────────────────

export async function createSession(opts?: {
  contextId?: string;
  keepAlive?: boolean;
  timeout?: number;
  recordSession?: boolean;
  viewport?: { width: number; height: number };
  mobile?: boolean;
}): Promise<SessionInfo> {
  const { bb, config } = requireInit();

  const createParams: Parameters<typeof bb.sessions.create>[0] = {
    projectId: config.projectId,
    region: 'us-east-1',
  };

  // Server-side timeout as safety net (if sidecar crashes, Browserbase still cleans up)
  if (opts?.timeout) createParams.timeout = opts.timeout;

  if (opts?.keepAlive) createParams.keepAlive = true;

  // Browser settings: privacy defaults, ad blocking, context persistence
  const browserSettings: Record<string, unknown> = {
    blockAds: true,
    recordSession: opts?.recordSession ?? false,  // Off by default — privacy (banking, passwords)
  };

  // Viewport configuration
  if (opts?.mobile) {
    // Mobile defaults: iPhone 14 dimensions
    const mobileViewport = opts.viewport ?? { width: 390, height: 844 };
    browserSettings.viewport = mobileViewport;
    // Note: advancedStealth may override fingerprint settings. If mobile fingerprint
    // isn't being applied, check if advancedStealth is enabled on the Browserbase project.
    browserSettings.fingerprint = {
      devices: ['mobile'],
      operatingSystems: ['ios'],
    };
  } else if (opts?.viewport) {
    browserSettings.viewport = opts.viewport;
  }

  if (opts?.contextId) {
    browserSettings.context = { id: opts.contextId, persist: true };
  }
  createParams.browserSettings = browserSettings as typeof createParams.browserSettings;

  let session;
  try {
    session = await bb.sessions.create(createParams);
  } catch (err: unknown) {
    throw wrapApiError(err, 'createSession');
  }

  let debugInfo;
  try {
    debugInfo = await bb.sessions.debug(session.id);
  } catch (err: unknown) {
    throw wrapApiError(err, 'getDebugInfo');
  }

  const info: SessionInfo = {
    sessionId: session.id,
    connectUrl: session.connectUrl,
    liveViewUrl: debugInfo.debuggerFullscreenUrl,
  };

  // Connect via CDP — pass viewport so it's enforced on the Playwright page
  const effectiveViewport = opts?.mobile
    ? (opts.viewport ?? { width: 390, height: 844 })
    : opts?.viewport;
  await connectCDP(info, { viewport: effectiveViewport, mobile: opts?.mobile });

  return info;
}

export async function closeSession(opts?: {
  saveContext?: boolean;
}): Promise<{ sessionId: string; contextSaved: boolean } | void> {
  const { bb, config } = requireInit();

  if (!activeSession) return;

  const sessionId = activeSession.info.sessionId;

  // Disconnect browser
  try {
    await activeSession.browser.close();
  } catch {
    // Already closed — that's fine
  }

  // Release the session on Browserbase
  // When saveContext is true, the session's browser context (cookies, localStorage, etc.)
  // is persisted on Browserbase's side via the context ID used at creation time.
  // We still REQUEST_RELEASE — persistence is handled by the context settings, not the close call.
  // The caller is responsible for recording the context ID in context-store.ts.
  try {
    await bb.sessions.update(sessionId, {
      projectId: config.projectId,
      status: 'REQUEST_RELEASE',
    });
  } catch (err: unknown) {
    throw wrapApiError(err, 'closeSession');
  }

  const result = {
    sessionId,
    contextSaved: opts?.saveContext ?? false,
  };

  activeSession = null;
  return result;
}

export function getActiveSession(): ActiveSession | null {
  return activeSession;
}

// ── CDP Connection with Reconnection ─────────────────────────

const RECONNECT_DELAYS = [2000, 5000, 10000];

async function connectCDP(info: SessionInfo, opts?: {
  viewport?: { width: number; height: number };
  mobile?: boolean;
}): Promise<void> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= RECONNECT_DELAYS.length; attempt++) {
    try {
      const browser = await chromium.connectOverCDP(info.connectUrl);
      const context = browser.contexts()[0];
      if (!context) throw new Error('No browser context available after CDP connect');
      const page = context.pages()[0] || await context.newPage();

      // Enforce viewport on the Playwright page (Browserbase API sets it at creation,
      // but CDP connection may not inherit it)
      if (opts?.viewport) {
        await page.setViewportSize(opts.viewport);
      }

      activeSession = { info, browser, context, page, viewport: opts?.viewport, mobile: opts?.mobile };
      return;
    } catch (err: unknown) {
      lastError = err instanceof Error ? err : new Error(String(err));

      if (attempt < RECONNECT_DELAYS.length) {
        const delay = RECONNECT_DELAYS[attempt];
        console.error(`CDP connect attempt ${attempt + 1} failed, retrying in ${delay}ms...`);
        await sleep(delay);
      }
    }
  }

  throw new Error(
    `CDP connection failed after ${RECONNECT_DELAYS.length + 1} attempts: ${lastError?.message}`
  );
}

export async function reconnect(): Promise<void> {
  if (!activeSession) throw new Error('No active session to reconnect');
  const { info, viewport, mobile } = activeSession;

  // Close stale browser handle
  try { await activeSession.browser.close(); } catch { /* ignore */ }
  activeSession = null;

  await connectCDP(info, { viewport, mobile });
}

// ── Navigation ───────────────────────────────────────────────

export async function navigateTo(url: string): Promise<void> {
  const page = requirePage();
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
}

export async function click(selectorOrText: string): Promise<void> {
  const page = requirePage();
  // Try as CSS selector first, then fall back to text matching
  try {
    await page.click(selectorOrText, { timeout: 5000 });
  } catch {
    await page.getByText(selectorOrText, { exact: false }).first().click({ timeout: 5000 });
  }
}

export async function type(text: string, selector?: string): Promise<void> {
  const page = requirePage();
  if (selector) {
    await page.fill(selector, text);
  } else {
    // Type into the currently focused element
    await page.keyboard.type(text, { delay: 30 });
  }
}

export async function pressKey(key: string): Promise<void> {
  const page = requirePage();
  await page.keyboard.press(key);
}

export async function scroll(direction: 'up' | 'down', amount?: number): Promise<void> {
  const page = requirePage();
  const pixels = amount ?? 500;
  const delta = direction === 'down' ? pixels : -pixels;
  await page.mouse.wheel(0, delta);
}

// ── Screenshots ──────────────────────────────────────────────

/** Max screenshot size before we fall back to JPEG compression (512 KB) */
const MAX_PNG_BYTES = 512 * 1024;
/** JPEG quality for fallback compression */
const JPEG_QUALITY = 70;
/** Absolute max — reject anything over this even after compression (2 MB) */
const ABSOLUTE_MAX_BYTES = 2 * 1024 * 1024;

export async function getScreenshot(): Promise<Buffer> {
  const page = requirePage();

  // Set a reasonable viewport if it's absurdly large (high-DPI can cause huge captures)
  // But don't override intentional mobile viewports
  if (!activeSession?.mobile) {
    const viewport = page.viewportSize();
    if (viewport && (viewport.width > 1440 || viewport.height > 900)) {
      await page.setViewportSize({ width: 1280, height: 800 });
    }
  }

  let buf = Buffer.from(await page.screenshot({ type: 'png', fullPage: false }));

  // If PNG is too large, re-capture as compressed JPEG
  if (buf.length > MAX_PNG_BYTES) {
    buf = Buffer.from(await page.screenshot({ type: 'jpeg', quality: JPEG_QUALITY, fullPage: false }));
  }

  // If still too large after JPEG, try lower quality
  if (buf.length > ABSOLUTE_MAX_BYTES) {
    buf = Buffer.from(await page.screenshot({ type: 'jpeg', quality: 40, fullPage: false }));
  }

  if (buf.length > ABSOLUTE_MAX_BYTES) {
    throw new Error(`Screenshot too large (${(buf.length / 1024).toFixed(0)} KB) even after compression`);
  }

  return buf;
}

// ── Live View ────────────────────────────────────────────────

export async function getLiveViewUrl(): Promise<string> {
  const { bb } = requireInit();
  if (!activeSession) throw new Error('No active session');

  try {
    const debugInfo = await bb.sessions.debug(activeSession.info.sessionId);
    return debugInfo.debuggerFullscreenUrl;
  } catch (err: unknown) {
    throw wrapApiError(err, 'getLiveViewUrl');
  }
}

// ── Session Listing (for orphan cleanup) ─────────────────────

export async function listActiveSessions(): Promise<Array<{ id: string; createdAt: string; status: string }>> {
  const { bb } = requireInit();

  try {
    const sessions = await bb.sessions.list({ status: 'RUNNING' });
    return sessions.map(s => ({
      id: s.id,
      createdAt: s.createdAt,
      status: s.status,
    }));
  } catch (err: unknown) {
    throw wrapApiError(err, 'listActiveSessions');
  }
}

// ── Dead Session Detection ────────────────────────────────────

/**
 * Determine if an error indicates the browser session has died
 * (disconnected, timed out on Browserbase side, WebSocket closed).
 *
 * Primary detection: Playwright error class and known error patterns.
 * Fallback: string matching for edge cases.
 */
export function isSessionDead(err: unknown): boolean {
  if (!(err instanceof Error)) return false;

  const msg = err.message;

  // Playwright's TargetClosedError / browser disconnected
  if (err.constructor?.name === 'TargetClosedError') return true;

  // WebSocket / CDP disconnection patterns
  if (msg.includes('Target closed') || msg.includes('target closed')) return true;
  if (msg.includes('browser has been closed') || msg.includes('Browser closed')) return true;
  if (msg.includes('Session closed') || msg.includes('session closed')) return true;
  if (msg.includes('WebSocket is not open') || msg.includes('WebSocket error')) return true;
  if (msg.includes('Protocol error') && msg.includes('Target closed')) return true;
  if (msg.includes('Connection refused') || msg.includes('ECONNREFUSED')) return true;
  if (msg.includes('net::ERR_CONNECTION_REFUSED')) return true;

  // Browserbase server-side timeout
  if (msg.includes('Session has been terminated') || msg.includes('timed out')) return true;

  return false;
}

// ── Helpers ──────────────────────────────────────────────────

function requirePage(): Page {
  if (!activeSession?.page) throw new Error('No active browser session — call createSession() first');
  return activeSession.page;
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function wrapApiError(err: unknown, context: string): Error {
  if (err instanceof Error) {
    const msg = err.message;
    if (msg.includes('429')) {
      return new Error(`Rate limited during ${context} — too many concurrent sessions or requests. Try again shortly.`);
    }
    if (msg.includes('500') || msg.includes('502') || msg.includes('503')) {
      return new Error(`Browserbase server error during ${context} — the service may be temporarily unavailable.`);
    }
    if (msg.includes('401') || msg.includes('403')) {
      return new Error(`Authentication failed during ${context} — check API key and project ID.`);
    }
    return new Error(`Browserbase ${context} failed: ${msg}`);
  }
  return new Error(`Browserbase ${context} failed: ${String(err)}`);
}
