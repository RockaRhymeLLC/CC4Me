/**
 * main.ts — Browser sidecar HTTP server
 *
 * Standalone Node.js process that manages Browserbase sessions.
 * Communicates with the daemon via HTTP on port 3849.
 * Follows TTS worker pattern: stdout READY signal, /health endpoint.
 */

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import Browserbase from '@browserbasehq/sdk';
import crypto from 'node:crypto';
import * as sm from './session-manager.js';
import { isSessionDead } from './session-manager.js';
import * as ctx from './context-store.js';

const DEFAULT_PORT = 3849;
const DEFAULT_DAEMON_PORT = 3847;
const port = parseInt(process.argv.find(a => a.startsWith('--port='))?.split('=')[1] ?? '', 10) || DEFAULT_PORT;
const daemonPort = parseInt(process.env.DAEMON_PORT ?? '', 10) || DEFAULT_DAEMON_PORT;

// ── Keychain ─────────────────────────────────────────────────

function getCredential(service: string): string | null {
  try {
    return execFileSync('security', ['find-generic-password', '-s', service, '-w'], {
      encoding: 'utf8',
      timeout: 5000,
    }).trim();
  } catch {
    return null;
  }
}

// ── Request Helpers ──────────────────────────────────────────

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', chunk => { data += chunk; });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

function jsonResponse(res: http.ServerResponse, status: number, body: unknown): void {
  const json = JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(json) });
  res.end(json);
}

function pngResponse(res: http.ServerResponse, buffer: Buffer): void {
  res.writeHead(200, { 'Content-Type': 'image/png', 'Content-Length': buffer.length });
  res.end(buffer);
}

// ── Session state tracking ───────────────────────────────────

let sessionMeta: {
  sessionId: string;
  liveViewUrl: string;
  startedAt: string;
  contextName: string | null;
  url: string | null;
  viewport: { width: number; height: number } | null;
  mobile: boolean;
} | null = null;

// ── Hand-off wrapper page ────────────────────────────────────

/** Random token per session — prevents unauthorized access to the wrapper page */
let handoffToken: string | null = null;

function generateHandoffToken(): string {
  handoffToken = crypto.randomBytes(16).toString('hex');
  return handoffToken;
}

function buildWrapperHtml(liveViewUrl: string): string {
  return `<!DOCTYPE html>
<html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no">
<title>CC4Me Browser</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
html,body{height:100%;overflow:hidden;font-family:-apple-system,system-ui,sans-serif;background:#0d1117}
.container{display:flex;flex-direction:column;height:100%}
.status{padding:6px 12px;background:#161b22;color:#58a6ff;font-size:12px;text-align:center;border-bottom:1px solid #30363d}
.browser-frame{flex:1;position:relative;overflow:hidden}
.browser-frame iframe{width:100%;height:100%;border:none}
.controls{padding:8px;background:#161b22;border-top:1px solid #30363d;display:flex;gap:6px;align-items:center}
.text-input{flex:1;padding:10px 14px;border:1px solid #30363d;border-radius:20px;background:#0d1117;color:#e6edf3;font-size:16px;outline:none}
.text-input:focus{border-color:#58a6ff}
.text-input::placeholder{color:#484f58}
.btn{padding:8px 14px;border:none;border-radius:16px;font-size:13px;font-weight:600;cursor:pointer;white-space:nowrap;-webkit-tap-highlight-color:transparent}
.btn:active{opacity:0.7}
.btn-send{background:#238636;color:#fff;padding:8px 18px}
.btn-key{background:#21262d;color:#c9d1d9;font-size:12px;padding:6px 10px}
.btn-done{background:#1f6feb;color:#fff}
.key-row{display:flex;gap:4px;padding:4px 8px;background:#161b22;justify-content:center}
.loading{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;background:#0d1117;color:#58a6ff;font-size:16px}
</style></head><body>
<div class="container">
<div class="status" id="status">Connecting...</div>
<div class="browser-frame">
<div class="loading" id="loading">Loading browser view...</div>
<iframe id="liveView" src="${liveViewUrl}" allow="clipboard-read;clipboard-write" onload="document.getElementById('loading').style.display='none';document.getElementById('status').textContent='Connected'"></iframe>
</div>
<div class="key-row">
<button class="btn btn-key" onclick="pressKey('Tab')">Tab</button>
<button class="btn btn-key" onclick="pressKey('Enter')">Enter</button>
<button class="btn btn-key" onclick="pressKey('Escape')">Esc</button>
<button class="btn btn-key" onclick="pressKey('Backspace')">&#9003;</button>
<button class="btn btn-done" onclick="handoffDone()">Done</button>
</div>
<div class="controls">
<input type="text" class="text-input" id="textInput" placeholder="Type text here, then tap Send..." autocomplete="off" enterkeyhint="send" />
<button class="btn btn-send" id="sendBtn" onclick="sendText()">Send</button>
</div>
</div>
<script>
const input=document.getElementById('textInput');
const status=document.getElementById('status');

async function api(method,path,body){
  try{
    const opts={method,headers:{'Content-Type':'application/json'}};
    if(body)opts.body=JSON.stringify(body);
    const r=await fetch(path,opts);
    return{ok:r.ok,data:await r.json().catch(()=>({}))};
  }catch(e){return{ok:false,data:{error:e.message}}}
}

async function sendText(){
  const text=input.value;
  if(!text)return;
  input.disabled=true;
  const r=await api('POST','/session/type',{text});
  input.disabled=false;
  if(r.ok){
    input.value='';
    status.textContent='Sent: '+(text.length>30?text.slice(0,30)+'...':text);
  }else{
    status.textContent='Error: '+(r.data.error||'failed');
  }
  input.focus();
}

async function pressKey(key){
  const r=await api('POST','/session/press-key',{key});
  if(r.ok){
    status.textContent='Key: '+key;
  }else{
    status.textContent='Error: '+(r.data.error||'key failed');
  }
}

async function handoffDone(){
  status.textContent='Completing hand-off...';
  await api('POST','/handoff/done');
  status.textContent='Hand-off complete! You can close this page.';
  document.querySelector('.controls').style.display='none';
  document.querySelector('.key-row').style.display='none';
}

input.addEventListener('keypress',e=>{if(e.key==='Enter')sendText()});

// Keep status fresh
setInterval(async()=>{
  const r=await api('GET','/session/status');
  if(!r.ok||!r.data.active){
    status.textContent='Session ended';
    document.querySelector('.controls').style.display='none';
    document.querySelector('.key-row').style.display='none';
  }
},15000);
</script>
</body></html>`;
}

// ── Session state persistence (crash recovery) ──────────────

let sessionStatePath = '';

interface PersistedSessionState {
  sessionId: string;
  connectUrl: string;
  contextName: string | null;
  handoffActive: boolean;
  startedAt: string;
}

function persistSessionState(state: PersistedSessionState): void {
  try {
    const tmp = sessionStatePath + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
    fs.renameSync(tmp, sessionStatePath);
  } catch (err) {
    console.error('Failed to persist session state:', err instanceof Error ? err.message : err);
  }
}

function readSessionState(): PersistedSessionState | null {
  try {
    const raw = fs.readFileSync(sessionStatePath, 'utf-8');
    return JSON.parse(raw) as PersistedSessionState;
  } catch {
    return null;
  }
}

function deleteSessionState(): void {
  try {
    fs.unlinkSync(sessionStatePath);
  } catch {
    // Doesn't exist — that's fine
  }
}

// ── Orphan session recovery ──────────────────────────────────

async function recoverOrphanSessions(): Promise<{ cleaned: number; reconnected: number }> {
  let cleaned = 0;
  let reconnected = 0;

  const savedState = readSessionState();

  try {
    const running = await sm.listActiveSessions();

    if (running.length === 0) {
      console.log('No orphaned sessions found');
      deleteSessionState();
      return { cleaned, reconnected };
    }

    console.log(`Found ${running.length} running session(s) on startup`);

    for (const session of running) {
      const isSaved = savedState?.sessionId === session.id;
      const wasHandoff = isSaved && savedState.handoffActive;

      if (wasHandoff) {
        // On free tier, we can't reconnect (no keepAlive). Just log and close.
        // Future: attempt CDP reconnect on Developer plan
        console.log(`Orphaned hand-off session ${session.id} — closing (free tier, cannot reconnect)`);
      } else {
        console.log(`Closing orphaned session ${session.id}`);
      }

      try {
        // Close via session manager's Browserbase client
        const bb = new Browserbase({ apiKey: getCredential('credential-browserbase-api-key')! });
        await bb.sessions.update(session.id, {
          projectId: getCredential('credential-browserbase-project-id')!,
          status: 'REQUEST_RELEASE',
        });
        cleaned++;
        console.log(`Closed orphaned session ${session.id}`);
      } catch (err) {
        console.error(`Failed to close orphaned session ${session.id}:`, err instanceof Error ? err.message : err);
      }
    }
  } catch (err) {
    console.error('Orphan recovery failed:', err instanceof Error ? err.message : err);
  }

  deleteSessionState();
  return { cleaned, reconnected };
}

// ── Timeout Manager ──────────────────────────────────────────

interface TimeoutConfig {
  sessionTimeoutSec: number;        // Automation session timeout (default 300s)
  sessionWarningSec: number;        // Warn before automation timeout (default 60s)
  handoffSessionTimeoutSec: number; // Hard cap on hand-off session lifetime (default 1800s)
  handoffIdleWarnSec: number;       // Remind after idle during hand-off (default 600s)
  handoffIdleTimeoutSec: number;    // Close after idle hand-off (default 1800s)
}

let timeoutConfig: TimeoutConfig = {
  sessionTimeoutSec: parseInt(process.env.SESSION_TIMEOUT ?? '', 10) || 300,
  sessionWarningSec: parseInt(process.env.SESSION_WARNING ?? '', 10) || 60,
  handoffSessionTimeoutSec: parseInt(process.env.HANDOFF_SESSION_TIMEOUT ?? '', 10) || 1800,
  handoffIdleWarnSec: parseInt(process.env.HANDOFF_IDLE_WARN ?? '', 10) || 600,
  handoffIdleTimeoutSec: parseInt(process.env.HANDOFF_IDLE_TIMEOUT ?? '', 10) || 1800,
};

let sessionTimer: ReturnType<typeof setTimeout> | null = null;
let sessionWarningTimer: ReturnType<typeof setTimeout> | null = null;
let handoffSessionTimer: ReturnType<typeof setTimeout> | null = null; // Hard cap on hand-off session lifetime
let handoffIdleWarnTimer: ReturnType<typeof setTimeout> | null = null;
let handoffIdleTimeoutTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Send a notification to the daemon, which forwards to Telegram.
 * Falls back silently if daemon is unreachable.
 */
function notifyDaemon(endpoint: string, body: unknown): void {
  const payload = JSON.stringify(body);
  const req = http.request({
    hostname: 'localhost',
    port: daemonPort,
    path: endpoint,
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) },
  });
  req.on('error', () => {}); // Silently ignore
  req.write(payload);
  req.end();
}

function startSessionTimeout(): void {
  clearSessionTimeout();

  const timeoutMs = timeoutConfig.sessionTimeoutSec * 1000;
  const warningMs = (timeoutConfig.sessionTimeoutSec - timeoutConfig.sessionWarningSec) * 1000;

  // Warning timer (fires sessionWarningSec before timeout)
  if (warningMs > 0) {
    sessionWarningTimer = setTimeout(() => {
      const remainSec = timeoutConfig.sessionWarningSec;
      console.log(`Session timeout warning: ${remainSec}s remaining`);
      // Inject warning into Claude session via daemon
      notifyDaemon('/browser/timeout-warning', {
        type: 'session-timeout-warning',
        remainingSeconds: remainSec,
        message: `Browser session closing in ${remainSec} seconds.`,
      });
    }, warningMs);
  }

  // Timeout timer (auto-close session)
  sessionTimer = setTimeout(async () => {
    console.log('Session timeout reached — auto-closing');
    try {
      // Save context before closing
      if (sessionMeta?.contextName) {
        ctx.updateLastUsed(sessionMeta.contextName);
      }
      await sm.closeSession({ saveContext: true });
      sessionMeta = null;
      deleteSessionState();
      notifyDaemon('/browser/timeout-warning', {
        type: 'session-timeout',
        message: 'Browser session closed (timeout). Context saved.',
      });
    } catch (err) {
      console.error('Auto-close on timeout failed:', err instanceof Error ? err.message : err);
    }
  }, timeoutMs);
}

function clearSessionTimeout(): void {
  if (sessionTimer) { clearTimeout(sessionTimer); sessionTimer = null; }
  if (sessionWarningTimer) { clearTimeout(sessionWarningTimer); sessionWarningTimer = null; }
}

function startHandoffIdleTimers(): void {
  clearHandoffIdleTimers();

  // Idle warning
  handoffIdleWarnTimer = setTimeout(() => {
    const site = sessionMeta?.url ?? 'the browser';
    console.log('Hand-off idle warning');
    notifyDaemon('/browser/timeout-warning', {
      type: 'handoff-idle-warning',
      message: `Still waiting for your help on ${site}...`,
    });
  }, timeoutConfig.handoffIdleWarnSec * 1000);

  // Idle timeout
  handoffIdleTimeoutTimer = setTimeout(async () => {
    console.log('Hand-off idle timeout — closing session');
    // Clear warning timer so it doesn't fire as a ghost after session is closed
    if (handoffIdleWarnTimer) { clearTimeout(handoffIdleWarnTimer); handoffIdleWarnTimer = null; }
    clearHandoffSessionTimer();
    try {
      // Capture info before clearing
      const url = sessionMeta?.url;
      const contextName = sessionMeta?.contextName;
      if (contextName) {
        ctx.updateLastUsed(contextName);
      }
      await sm.closeSession({ saveContext: true });
      sessionMeta = null;
      deleteSessionState();
      notifyDaemon('/browser/timeout-warning', {
        type: 'handoff-idle-timeout',
        message: 'Closed browser session (no response). Will retry when you\'re available.',
        url,
        contextName,
      });
      // Deactivate hand-off on daemon side
      notifyDaemon('/browser/handoff/stop', {});
    } catch (err) {
      console.error('Auto-close on hand-off idle failed:', err instanceof Error ? err.message : err);
    }
  }, timeoutConfig.handoffIdleTimeoutSec * 1000);
}

function clearHandoffIdleTimers(): void {
  if (handoffIdleWarnTimer) { clearTimeout(handoffIdleWarnTimer); handoffIdleWarnTimer = null; }
  if (handoffIdleTimeoutTimer) { clearTimeout(handoffIdleTimeoutTimer); handoffIdleTimeoutTimer = null; }
}

/**
 * Start the hand-off session timer — hard cap on how long a hand-off session can live.
 * Independent from idle timers. Cannot be reset by user activity.
 */
function startHandoffSessionTimer(): void {
  clearHandoffSessionTimer();

  const timeoutMs = timeoutConfig.handoffSessionTimeoutSec * 1000;
  console.log(`Hand-off session timer started: ${timeoutConfig.handoffSessionTimeoutSec}s`);

  handoffSessionTimer = setTimeout(async () => {
    console.log('Hand-off session hard timeout — closing session');
    try {
      if (sessionMeta?.contextName) {
        ctx.updateLastUsed(sessionMeta.contextName);
      }
      const url = sessionMeta?.url;
      const contextName = sessionMeta?.contextName;
      await sm.closeSession({ saveContext: true });
      sessionMeta = null;
      deleteSessionState();
      notifyDaemon('/browser/timeout-warning', {
        type: 'handoff-idle-timeout',
        message: 'Hand-off session reached maximum duration. Context saved.',
        url,
        contextName,
      });
      notifyDaemon('/browser/handoff/stop', {});
    } catch (err) {
      console.error('Hand-off session timer close failed:', err instanceof Error ? err.message : err);
    }
  }, timeoutMs);
}

function clearHandoffSessionTimer(): void {
  if (handoffSessionTimer) { clearTimeout(handoffSessionTimer); handoffSessionTimer = null; }
}

/** Reset hand-off idle timers on user interaction (type:, screenshot, etc.) */
function resetHandoffIdleTimers(): void {
  const saved = readSessionState();
  if (saved?.handoffActive) {
    startHandoffIdleTimers();
  }
}

function clearAllTimers(): void {
  clearSessionTimeout();
  clearHandoffSessionTimer();
  clearHandoffIdleTimers();
}

// ── Safe Screenshot Helpers ──────────────────────────────────

/** Take a screenshot, returning null on any failure instead of throwing */
async function safeScreenshot(): Promise<Buffer | null> {
  try {
    return await sm.getScreenshot();
  } catch (err) {
    console.error('Screenshot failed:', err instanceof Error ? err.message : err);
    return null;
  }
}

/** Take a screenshot and return base64 string, or null on failure */
async function safeScreenshotBase64(): Promise<string | null> {
  const buf = await safeScreenshot();
  return buf ? buf.toString('base64') : null;
}

// ── Dead Session Guard ───────────────────────────────────────

/** Mutex to prevent multiple concurrent dead-session cleanups */
let _cleaningUp = false;

/**
 * Wrap a route handler to detect dead sessions. If the session dies mid-request,
 * clean up local state, notify daemon, and return an error response.
 */
function withSessionGuard(
  handler: (req: http.IncomingMessage, res: http.ServerResponse) => Promise<void>,
): (req: http.IncomingMessage, res: http.ServerResponse) => Promise<void> {
  return async (req, res) => {
    try {
      await handler(req, res);
    } catch (err: unknown) {
      if (isSessionDead(err) && !_cleaningUp) {
        _cleaningUp = true;
        console.error('Dead session detected — cleaning up');

        // Collect info before clearing
        const deadUrl = sessionMeta?.url ?? undefined;
        const deadContext = sessionMeta?.contextName ?? undefined;

        // Clean up local state
        clearAllTimers();
        sessionMeta = null;
        deleteSessionState();

        // Notify daemon so it can deactivate hand-off and notify the human
        notifyDaemon('/browser/timeout-warning', {
          type: 'session-died',
          message: 'Browser session ended unexpectedly.',
          url: deadUrl,
          contextName: deadContext,
        });

        _cleaningUp = false;

        if (!res.headersSent) {
          jsonResponse(res, 502, { error: 'Browser session has ended unexpectedly' });
        }
      } else if (!res.headersSent) {
        const msg = err instanceof Error ? err.message : String(err);
        jsonResponse(res, 500, { error: msg });
      }
    }
  };
}

// ── Route Handlers ───────────────────────────────────────────

async function handleHealth(_req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  jsonResponse(res, 200, {
    status: 'ok',
    activeSession: sessionMeta ? { sessionId: sessionMeta.sessionId, startedAt: sessionMeta.startedAt } : null,
  });
}

async function handleSessionStart(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  if (sessionMeta) {
    jsonResponse(res, 409, { error: 'A session is already active', sessionId: sessionMeta.sessionId });
    return;
  }

  let body: {
    url?: string;
    contextId?: string;
    contextName?: string;
    keepAlive?: boolean;
    viewport?: { width: number; height: number };
    mobile?: boolean;
  } = {};
  try {
    const raw = await readBody(req);
    if (raw) body = JSON.parse(raw);
  } catch {
    jsonResponse(res, 400, { error: 'Invalid JSON body' });
    return;
  }

  try {
    // Resolve context: if contextName provided, look up or create context ID
    let contextId = body.contextId;
    if (body.contextName && !contextId) {
      const domain = body.url ? new URL(body.url).hostname : 'unknown';
      contextId = await ctx.getOrCreateContext(body.contextName, domain);
    }

    // Use the longer hand-off timeout for Browserbase server-side safety net
    // (the session might be promoted to hand-off mode later)
    const serverTimeout = Math.max(timeoutConfig.sessionTimeoutSec, timeoutConfig.handoffSessionTimeoutSec);
    const info = await sm.createSession({
      contextId,
      keepAlive: body.keepAlive,
      timeout: serverTimeout,
      viewport: body.viewport,
      mobile: body.mobile,
    });

    // Navigate to URL if provided
    if (body.url) {
      await sm.navigateTo(body.url);
    }

    // Auto-screenshot on session start (non-fatal if it fails)
    const screenshot = await safeScreenshotBase64();

    // Determine effective viewport for metadata
    const effectiveViewport = body.mobile
      ? (body.viewport ?? { width: 390, height: 844 })
      : (body.viewport ?? null);

    sessionMeta = {
      sessionId: info.sessionId,
      liveViewUrl: info.liveViewUrl,
      startedAt: new Date().toISOString(),
      contextName: body.contextName ?? null,
      url: body.url ?? null,
      viewport: effectiveViewport,
      mobile: body.mobile ?? false,
    };

    // Persist state for crash recovery
    persistSessionState({
      sessionId: info.sessionId,
      connectUrl: info.connectUrl,
      contextName: body.contextName ?? null,
      handoffActive: false,
      startedAt: sessionMeta.startedAt,
    });

    // Start session timeout
    startSessionTimeout();

    // Generate token for wrapper page access
    const token = generateHandoffToken();

    jsonResponse(res, 200, {
      sessionId: info.sessionId,
      liveViewUrl: info.liveViewUrl,
      wrapperPath: `/handoff/page?token=${token}`,
      ...(screenshot ? { screenshot } : {}),
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('Session start failed:', msg);
    jsonResponse(res, 500, { error: msg });
  }
}

async function handleSessionStop(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  if (!sessionMeta) {
    jsonResponse(res, 404, { error: 'No active session' });
    return;
  }

  let body: { saveContext?: boolean } = {};
  try {
    const raw = await readBody(req);
    if (raw) body = JSON.parse(raw);
  } catch {
    jsonResponse(res, 400, { error: 'Invalid JSON body' });
    return;
  }

  const stoppedSession = sessionMeta.sessionId;
  clearAllTimers();

  try {
    await sm.closeSession({ saveContext: body.saveContext });

    // Update context timestamps if saving
    if (body.saveContext && sessionMeta.contextName) {
      ctx.updateLastUsed(sessionMeta.contextName);
      ctx.updateLastVerified(sessionMeta.contextName);
    }

    sessionMeta = null;
    deleteSessionState();
    jsonResponse(res, 200, { stopped: stoppedSession, contextSaved: body.saveContext ?? false });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('Session stop failed:', msg);
    jsonResponse(res, 500, { error: msg });
  }
}

async function handleSessionStatus(_req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  if (!sessionMeta) {
    jsonResponse(res, 200, { active: false });
    return;
  }

  jsonResponse(res, 200, {
    active: true,
    sessionId: sessionMeta.sessionId,
    liveViewUrl: sessionMeta.liveViewUrl,
    wrapperPath: handoffToken ? `/handoff/page?token=${handoffToken}` : null,
    startedAt: sessionMeta.startedAt,
    contextName: sessionMeta.contextName,
    url: sessionMeta.url,
    viewport: sessionMeta.viewport,
    mobile: sessionMeta.mobile,
  });
}

async function handleSessionScreenshot(_req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  if (!sessionMeta) {
    jsonResponse(res, 404, { error: 'No active session' });
    return;
  }
  resetHandoffIdleTimers();

  const screenshot = await safeScreenshot();
  if (screenshot) {
    pngResponse(res, screenshot);
  } else {
    jsonResponse(res, 500, { error: 'Screenshot capture failed' });
  }
}

// ── Navigation Endpoints ─────────────────────────────────────

function requireSession(res: http.ServerResponse): boolean {
  if (!sessionMeta) {
    jsonResponse(res, 404, { error: 'No active session' });
    return false;
  }
  return true;
}

async function screenshotJson(): Promise<string | null> {
  return safeScreenshotBase64();
}

async function handleNavigate(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  if (!requireSession(res)) return;

  let body: { url?: string } = {};
  try {
    const raw = await readBody(req);
    if (raw) body = JSON.parse(raw);
  } catch {
    jsonResponse(res, 400, { error: 'Invalid JSON body' });
    return;
  }

  if (!body.url) {
    jsonResponse(res, 400, { error: 'Missing required field: url' });
    return;
  }

  try {
    await sm.navigateTo(body.url);
    const screenshot = await screenshotJson();
    jsonResponse(res, 200, { navigated: body.url, ...(screenshot ? { screenshot } : {}) });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    jsonResponse(res, 500, { error: `Navigation failed: ${msg}` });
  }
}

async function handleClick(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  if (!requireSession(res)) return;
  resetHandoffIdleTimers();

  let body: { selector?: string; text?: string } = {};
  try {
    const raw = await readBody(req);
    if (raw) body = JSON.parse(raw);
  } catch {
    jsonResponse(res, 400, { error: 'Invalid JSON body' });
    return;
  }

  const target = body.selector ?? body.text;
  if (!target) {
    jsonResponse(res, 400, { error: 'Missing required field: selector or text' });
    return;
  }

  try {
    await sm.click(target);
    const screenshot = await screenshotJson();
    jsonResponse(res, 200, { clicked: body.selector ? 'selector' : 'text', ...(screenshot ? { screenshot } : {}) });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    jsonResponse(res, 500, { error: `Click failed: ${msg}` });
  }
}

async function handleType(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  if (!requireSession(res)) return;
  resetHandoffIdleTimers();

  let body: { text?: string; selector?: string } = {};
  try {
    const raw = await readBody(req);
    if (raw) body = JSON.parse(raw);
  } catch {
    jsonResponse(res, 400, { error: 'Invalid JSON body' });
    return;
  }

  if (!body.text) {
    jsonResponse(res, 400, { error: 'Missing required field: text' });
    return;
  }

  try {
    // Security: DO NOT log the text (may contain passwords during relay)
    await sm.type(body.text, body.selector);
    const screenshot = await screenshotJson();
    jsonResponse(res, 200, { typed: true, ...(screenshot ? { screenshot } : {}) });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    jsonResponse(res, 500, { error: `Type failed: ${msg}` });
  }
}

async function handleScroll(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  if (!requireSession(res)) return;
  resetHandoffIdleTimers();

  let body: { direction?: 'up' | 'down'; amount?: number } = {};
  try {
    const raw = await readBody(req);
    if (raw) body = JSON.parse(raw);
  } catch {
    jsonResponse(res, 400, { error: 'Invalid JSON body' });
    return;
  }

  const direction = body.direction ?? 'down';
  if (direction !== 'up' && direction !== 'down') {
    jsonResponse(res, 400, { error: 'direction must be "up" or "down"' });
    return;
  }

  try {
    await sm.scroll(direction, body.amount);
    const screenshot = await screenshotJson();
    jsonResponse(res, 200, { scrolled: direction, ...(screenshot ? { screenshot } : {}) });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    jsonResponse(res, 500, { error: `Scroll failed: ${msg}` });
  }
}

async function handlePressKey(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  if (!requireSession(res)) return;
  resetHandoffIdleTimers();

  let body: { key?: string } = {};
  try {
    const raw = await readBody(req);
    if (raw) body = JSON.parse(raw);
  } catch {
    jsonResponse(res, 400, { error: 'Invalid JSON body' });
    return;
  }

  if (!body.key) {
    jsonResponse(res, 400, { error: 'Missing required field: key' });
    return;
  }

  // Allow only safe key names (no arbitrary code execution)
  const ALLOWED_KEYS = ['Tab', 'Enter', 'Escape', 'Backspace', 'Delete', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space', 'Home', 'End', 'PageUp', 'PageDown'];
  if (!ALLOWED_KEYS.includes(body.key)) {
    jsonResponse(res, 400, { error: `Key not allowed. Allowed: ${ALLOWED_KEYS.join(', ')}` });
    return;
  }

  try {
    await sm.pressKey(body.key);
    const screenshot = await screenshotJson();
    jsonResponse(res, 200, { pressed: body.key, ...(screenshot ? { screenshot } : {}) });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    jsonResponse(res, 500, { error: `Press key failed: ${msg}` });
  }
}

// ── Hand-off Page Endpoints ──────────────────────────────────

async function handleHandoffPage(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  // Validate token
  const reqUrl = new URL(req.url ?? '/', `http://localhost:${port}`);
  const token = reqUrl.searchParams.get('token');
  if (!token || token !== handoffToken) {
    res.writeHead(403, { 'Content-Type': 'text/plain' });
    res.end('Access denied — invalid or expired token.');
    return;
  }

  if (!sessionMeta) {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('No active browser session.');
    return;
  }

  const html = buildWrapperHtml(sessionMeta.liveViewUrl);
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Content-Length': Buffer.byteLength(html) });
  res.end(html);
}

async function handleHandoffDone(_req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  if (!sessionMeta) {
    jsonResponse(res, 404, { error: 'No active session' });
    return;
  }

  // Take a screenshot for Claude's context
  const screenshot = await safeScreenshot();

  // Notify daemon to deactivate hand-off + inject completion message
  const screenshotInfo = screenshot ? ` Screenshot captured.` : '';
  notifyDaemon('/browser/handoff/stop', {});
  notifyDaemon('/browser/timeout-warning', {
    type: 'handoff-done-via-wrapper',
    message: `Human completed hand-off via wrapper page.${screenshotInfo}`,
  });

  // Save screenshot locally for Claude
  if (screenshot) {
    try {
      const stateDir = process.env.STATE_DIR ?? '.';
      const mediaDir = path.join(stateDir, 'telegram-media');
      fs.mkdirSync(mediaDir, { recursive: true });
      const screenshotPath = path.join(mediaDir, `handoff_done_${Date.now()}.png`);
      fs.writeFileSync(screenshotPath, screenshot);
    } catch (err) {
      console.error('Failed to save hand-off screenshot:', err instanceof Error ? err.message : err);
    }
  }

  // Switch back to automation timers
  clearHandoffSessionTimer();
  clearHandoffIdleTimers();
  startSessionTimeout();

  // Update persisted state
  const saved = readSessionState();
  if (saved) {
    saved.handoffActive = false;
    persistSessionState(saved);
  }

  jsonResponse(res, 200, { done: true });
}

// ── Context Endpoints ────────────────────────────────────────

async function handleListContexts(_req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  jsonResponse(res, 200, ctx.listContexts());
}

async function handleDeleteContext(_req: http.IncomingMessage, res: http.ServerResponse, name: string): Promise<void> {
  const deleted = ctx.deleteContext(name);
  if (deleted) {
    jsonResponse(res, 200, { deleted: name });
  } else {
    jsonResponse(res, 404, { error: `Context '${name}' not found` });
  }
}

// ── Cleanup Endpoint ─────────────────────────────────────────

async function handleCleanup(_req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  try {
    const result = await recoverOrphanSessions();
    jsonResponse(res, 200, { cleaned: result.cleaned, reconnected: result.reconnected });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    jsonResponse(res, 500, { error: msg });
  }
}

// ── Hand-off state persistence ───────────────────────────────

async function handleHandoffSet(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  let body: { active?: boolean } = {};
  try {
    const raw = await readBody(req);
    if (raw) body = JSON.parse(raw);
  } catch {
    jsonResponse(res, 400, { error: 'Invalid JSON body' });
    return;
  }

  // Update persisted state with hand-off flag
  const saved = readSessionState();
  if (saved) {
    saved.handoffActive = body.active ?? false;
    persistSessionState(saved);

    if (saved.handoffActive) {
      // Hand-off activated: cancel automation timer, start hand-off timers
      clearSessionTimeout();
      startHandoffSessionTimer();
      startHandoffIdleTimers();
      console.log('Timer switch: automation → hand-off');
    } else {
      // Hand-off deactivated: cancel hand-off timers, start fresh automation timer
      clearHandoffSessionTimer();
      clearHandoffIdleTimers();
      startSessionTimeout();
      console.log('Timer switch: hand-off → automation');
    }

    jsonResponse(res, 200, { handoffActive: saved.handoffActive });
  } else {
    jsonResponse(res, 404, { error: 'No active session state to update' });
  }
}

// ── Router ───────────────────────────────────────────────────

async function handleRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  const method = req.method ?? 'GET';
  const url = req.url ?? '/';

  try {
    if (method === 'GET' && url === '/health') return await handleHealth(req, res);
    if (method === 'POST' && url === '/session/start') return await handleSessionStart(req, res);
    if (method === 'POST' && url === '/session/stop') return await handleSessionStop(req, res);
    if (method === 'GET' && url === '/session/status') return await handleSessionStatus(req, res);
    if (method === 'GET' && url === '/session/screenshot') return await withSessionGuard(handleSessionScreenshot)(req, res);
    if (method === 'POST' && url === '/session/navigate') return await withSessionGuard(handleNavigate)(req, res);
    if (method === 'POST' && url === '/session/click') return await withSessionGuard(handleClick)(req, res);
    if (method === 'POST' && url === '/session/type') return await withSessionGuard(handleType)(req, res);
    if (method === 'POST' && url === '/session/scroll') return await withSessionGuard(handleScroll)(req, res);
    if (method === 'POST' && url === '/session/press-key') return await withSessionGuard(handlePressKey)(req, res);
    if (method === 'GET' && url.startsWith('/handoff/page')) return await handleHandoffPage(req, res);
    if (method === 'POST' && url === '/handoff/done') return await handleHandoffDone(req, res);
    if (method === 'GET' && url === '/contexts') return await handleListContexts(req, res);
    if (method === 'DELETE' && url.startsWith('/contexts/')) {
      const name = decodeURIComponent(url.slice('/contexts/'.length));
      return await handleDeleteContext(req, res, name);
    }
    if (method === 'POST' && url === '/cleanup') return await handleCleanup(req, res);
    if (method === 'POST' && url === '/handoff/set') return await handleHandoffSet(req, res);

    jsonResponse(res, 404, { error: 'Not found' });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('Unhandled route error:', msg);
    jsonResponse(res, 500, { error: 'Internal server error' });
  }
}

// ── Startup ──────────────────────────────────────────────────

function main(): void {
  // Read credentials from Keychain
  const apiKey = getCredential('credential-browserbase-api-key');
  const projectId = getCredential('credential-browserbase-project-id');

  if (!apiKey || !projectId) {
    console.error('Missing Browserbase credentials in Keychain');
    console.error('  credential-browserbase-api-key:', apiKey ? 'found' : 'MISSING');
    console.error('  credential-browserbase-project-id:', projectId ? 'found' : 'MISSING');
    process.exit(1);
  }

  // Resolve state directory for context manifest
  // Default: project root's .claude/state/
  const stateDir = process.env.STATE_DIR
    ?? path.resolve(new URL('.', import.meta.url).pathname, '../../.claude/state');
  const manifestPath = path.join(stateDir, 'browser-contexts.json');

  // Set session state path for crash recovery
  sessionStatePath = path.join(stateDir, 'browser-session.json');

  sm.init({ apiKey, projectId });

  // Init context store with Browserbase client for API calls
  const bbClient = new Browserbase({ apiKey });
  ctx.init({ manifestPath, bb: bbClient, projectId });

  // Recover orphaned sessions from previous runs
  recoverOrphanSessions().then(({ cleaned, reconnected }) => {
    if (cleaned > 0 || reconnected > 0) {
      console.log(`Orphan recovery: ${cleaned} closed, ${reconnected} reconnected`);
    }
  }).catch(err => {
    console.error('Orphan recovery error:', err instanceof Error ? err.message : err);
  });

  const server = http.createServer((req, res) => {
    handleRequest(req, res).catch(err => {
      console.error('Request handler crash:', err);
      if (!res.headersSent) {
        jsonResponse(res, 500, { error: 'Internal server error' });
      }
    });
  });

  server.listen(port, () => {
    console.log('READY');
  });

  // Graceful shutdown
  const shutdown = (): void => {
    console.log('Shutting down...');
    clearAllTimers();
    if (sessionMeta) {
      sm.closeSession().catch(() => {}).finally(() => {
        deleteSessionState();
        server.close(() => process.exit(0));
        setTimeout(() => process.exit(0), 3000);
      });
    } else {
      deleteSessionState();
      server.close(() => process.exit(0));
      setTimeout(() => process.exit(0), 3000);
    }
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

main();
