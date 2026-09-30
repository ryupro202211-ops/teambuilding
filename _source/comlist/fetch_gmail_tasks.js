'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { spawn } = require('node:child_process');

const { threadToTasks, textBodyParts } = require('./gmail_tasks');
const { validateDailyTasks } = require('./daily_tasks');

const GMAIL_SCOPE = 'https://www.googleapis.com/auth/gmail.readonly';
const { loadGardenPaths } = require('./garden_paths');
const GARDEN_PATHS = loadGardenPaths();
const DEFAULT_OAUTH_CLIENT_PATH = GARDEN_PATHS.gmailOAuthClient;
const DEFAULT_OAUTH_TOKEN_PATH = GARDEN_PATHS.gmailOAuthToken;
const DEFAULT_WORK_DIR = path.resolve(__dirname, '_work');

const GMAIL_QUERIES = [
  'りゅうちゃん in:inbox',
  'label:"◆自分タスク"',
];

async function listAllThreadIds(gmail, queries) {
  const threadIds = [];
  const seen = new Set();

  for (const query of queries) {
    let pageToken;
    do {
      const params = {
        userId: 'me',
        maxResults: 100,
        q: query,
      };
      if (pageToken) params.pageToken = pageToken;

      const response = await gmail.users.threads.list(params);
      const threads = response?.data?.threads || [];
      for (const thread of threads) {
        const id = thread?.id;
        if (id && !seen.has(id)) {
          seen.add(id);
          threadIds.push(id);
        }
      }
      pageToken = response?.data?.nextPageToken;
    } while (pageToken);
  }

  return threadIds;
}

async function fetchVerifiedGmailTasks(gmail, today) {
  let threadIds;
  try {
    threadIds = await listAllThreadIds(gmail, GMAIL_QUERIES);
  } catch {
    throw safeError('Gmail search failed', 'api-search');
  }
  const tasks = [];
  let checkedThreads = 0;

  for (const id of threadIds) {
    let response;
    try {
      response = await gmail.users.threads.get({
        userId: 'me',
        format: 'full',
        id,
      });
    } catch {
      throw safeError('Gmail thread fetch failed', 'api-thread');
    }
    if (!response?.data || !Array.isArray(response.data.messages)) {
      throw safeError('Gmail thread fetch returned no complete thread', 'thread-data');
    }
    try {
      await resolveMessageBodyAttachments(gmail, response.data);
      tasks.push(...threadToTasks(response.data, today));
    } catch (error) {
      if (error?.failureType) throw error;
      if (/body unavailable/i.test(String(error?.message || ''))) {
        throw safeError('Gmail message body could not be restored', 'body-unavailable');
      }
      if (/review required/i.test(String(error?.message || ''))) {
        throw safeError('Gmail task requires manual review', 'review-required');
      }
      if (/invalid continuation|invalid today|invalid Gmail internalDate/i.test(String(error?.message || ''))) {
        throw safeError('Gmail continuation line is invalid', 'invalid-continuation');
      }
      throw safeError('Gmail thread classification failed', 'classification');
    }
    checkedThreads += 1;
  }

  if (checkedThreads !== threadIds.length) {
    throw new Error('Gmail thread count verification failed');
  }

  return {
    tasks,
    checkedThreads,
    uniqueThreads: threadIds.length,
    counts: summarizeTaskCounts(tasks),
  };
}

function mergeGmailTasks(input, gmailResult, today) {
  if (!Array.isArray(input?.tasks)) throw new Error('input.tasks must be an array');
  if (!Array.isArray(gmailResult?.tasks)) throw new Error('gmailResult.tasks must be an array');
  if (!Number.isInteger(gmailResult.checkedThreads) || !Number.isInteger(gmailResult.uniqueThreads)
    || gmailResult.checkedThreads < 0 || gmailResult.uniqueThreads < 0
    || gmailResult.checkedThreads !== gmailResult.uniqueThreads) {
    throw new Error('Gmail checkedThreads must equal uniqueThreads');
  }
  const existingTasks = input.tasks;
  const tasks = [
    ...existingTasks.filter(task => task?.type !== 'gmail'),
    ...gmailResult.tasks,
  ];
  const hp = aggregateHp(tasks);
  const merged = {
    ...input,
    tasks,
    hp,
    hpNote: `自分の期限切れ ${hp.selfOverdue}件 ×-10 ／ メンバー切れ ${hp.memberOverdue}件 ×-5 ／ 毎朝100にリセット`,
    sources: {
      ...(input?.sources || {}),
      gmail: {
        ok: true,
        checkedThreads: gmailResult?.checkedThreads,
        uniqueThreads: gmailResult?.uniqueThreads,
      },
    },
  };

  return validateDailyTasks(merged, today, { requireSection: true });
}

function aggregateHp(tasks) {
  return {
    selfOverdue: tasks.filter(task => task?.section === 'selfOverdue').length,
    memberOverdue: tasks.filter(task => task?.section === 'memberOverdue').length,
  };
}

function summarizeTaskCounts(tasks) {
  return {
    overdue: tasks.filter(task => task?.section === 'selfOverdue' || task?.section === 'memberOverdue').length,
    today: tasks.filter(task => task?.section === 'today').length,
    upcoming: tasks.filter(task => task?.section === 'upcoming').length,
  };
}

async function resolveMessageBodyAttachments(gmail, thread) {
  for (const message of thread.messages) {
    for (const part of textBodyParts(message?.payload)) {
      const body = part.body && typeof part.body === 'object' ? part.body : {};
      if (!body.attachmentId || typeof body.data === 'string') continue;
      if (!message?.id || !gmail?.users?.messages?.attachments?.get) {
        throw safeError('Gmail message body could not be restored', 'body-unavailable');
      }
      let response;
      try {
        response = await gmail.users.messages.attachments.get({
          userId: 'me',
          messageId: message.id,
          id: body.attachmentId,
        });
      } catch {
        throw safeError('Gmail message body could not be restored', 'body-unavailable');
      }
      const data = response?.data?.data;
      if (typeof data !== 'string') {
        throw safeError('Gmail message body could not be restored', 'body-unavailable');
      }
      body.data = data;
    }
  }
}

function fsPromises(fsApi) {
  return fsApi?.promises || fsApi;
}

function safeError(message, failureType = 'internal') {
  const error = new Error(message);
  error.safeForCli = true;
  error.failureType = failureType;
  return error;
}

function resolvedOptionPath(value, fallback) {
  return path.resolve(value || fallback);
}

async function readJsonFile(filePath, fsApi) {
  const api = fsPromises(fsApi);
  const text = await api.readFile(filePath, 'utf8');
  return JSON.parse(text);
}

function isValidOAuthToken(token) {
  if (!token || typeof token !== 'object' || Array.isArray(token)) return false;
  const hasToken = ['refresh_token', 'access_token']
    .some(field => typeof token[field] === 'string' && token[field].trim().length > 0);
  if (!hasToken) return false;
  if (!Object.prototype.hasOwnProperty.call(token, 'scope')) return true;

  const scopes = Array.isArray(token.scope)
    ? token.scope
    : typeof token.scope === 'string'
      ? token.scope.trim().split(/\s+/).filter(Boolean)
      : [];
  return scopes.length === 1 && scopes[0] === GMAIL_SCOPE;
}

async function loadOAuthFiles(options = {}) {
  const fsApi = options.fsApi || fs;
  const clientPath = resolvedOptionPath(options.clientPath, DEFAULT_OAUTH_CLIENT_PATH);
  const tokenPath = resolvedOptionPath(options.tokenPath, DEFAULT_OAUTH_TOKEN_PATH);
  let rawClient;

  try {
    rawClient = await readJsonFile(clientPath, fsApi);
  } catch {
    throw safeError(`OAuthクライアントファイルが見つからないか不正です: ${clientPath}。Google Desktop OAuth JSONを配置してください。`, 'oauth-client');
  }

  const client = rawClient?.installed || rawClient?.web;
  if (!client || typeof client !== 'object'
    || typeof client.client_id !== 'string' || client.client_id.length === 0
    || typeof client.client_secret !== 'string' || client.client_secret.length === 0) {
    throw safeError(`OAuthクライアントファイルが見つからないか不正です: ${clientPath}。client_idとclient_secretを含むGoogle Desktop OAuth JSONを配置してください。`, 'oauth-client');
  }

  let token;
  if (options.requireToken !== false) {
    try {
      token = await readJsonFile(tokenPath, fsApi);
    } catch {
      throw safeError(`OAuthトークンファイルが見つからないか不正です: ${tokenPath}。先に --auth-only を実行してください。`, 'oauth-token');
    }
    if (!isValidOAuthToken(token)) {
      throw safeError(`OAuthトークンファイルが見つからないか不正です: ${tokenPath}。先に --auth-only を実行してください。`, 'oauth-token');
    }
  }

  return {
    client,
    token,
    clientPath,
    tokenPath,
    clientId: client.client_id,
    clientSecret: client.client_secret,
  };
}

function googleApiFrom(options = {}) {
  if (options.googleApi) return options.googleApi;
  if (options.google) return options.google;
  return require('googleapis').google;
}

async function createAuthorizedGmail(options = {}) {
  const files = await loadOAuthFiles(options);
  const googleApi = googleApiFrom(options);
  const auth = new googleApi.auth.OAuth2(
    files.clientId,
    files.clientSecret,
    options.redirectUri,
  );
  if (files.token) auth.setCredentials(files.token);
  return googleApi.gmail({ version: 'v1', auth });
}

function launchAuthorizationUrl(url, spawnApi = spawn) {
  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawnApi('rundll32.exe', ['url.dll,FileProtocolHandler', url], {
        shell: false,
        detached: true,
        windowsHide: true,
        stdio: 'ignore',
      });
    } catch {
      reject(safeError('OAuth authorization browser launch failed', 'oauth-browser'));
      return;
    }

    const hasEvents = child && (typeof child.once === 'function' || typeof child.on === 'function');
    if (!hasEvents) {
      child?.unref?.();
      resolve();
      return;
    }

    let settled = false;
    const succeed = () => {
      if (settled) return;
      settled = true;
      resolve();
    };
    const fail = () => {
      if (settled) return;
      settled = true;
      reject(safeError('OAuth authorization browser launch failed', 'oauth-browser'));
    };
    if (typeof child.once === 'function') {
      child.once('spawn', succeed);
      child.once('error', fail);
    } else {
      child.on('spawn', succeed);
      child.on('error', fail);
    }
    child?.unref?.();
  });
}

function respond(res, statusCode, body) {
  if (res) res.statusCode = statusCode;
  if (res?.end) res.end(body);
}

async function closeServer(server) {
  if (!server?.close) return;
  await new Promise(resolve => {
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      resolve();
    };
    try {
      const result = server.close(finish);
      if (result && typeof result.then === 'function') result.then(finish, finish);
      if (server.listening !== true) queueMicrotask(finish);
    } catch {
      finish();
    }
  });
}

async function listenOnLocalhost(server) {
  await new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error) => {
      if (settled) return;
      settled = true;
      if (server.removeListener) server.removeListener('error', onError);
      if (error) reject(error);
      else resolve();
    };
    const onError = error => finish(error);
    if (server.once) server.once('error', onError);
    else if (server.on) server.on('error', onError);
    try {
      const result = server.listen(0, '127.0.0.1', () => finish());
      if (result && typeof result.then === 'function') result.then(() => finish(), onError);
    } catch (error) {
      finish(error);
    }
  });
  const address = server.address?.();
  const port = typeof address === 'object' && address ? address.port : null;
  if (!Number.isInteger(port) || port <= 0) throw safeError('OAuth callback server did not provide a port', 'oauth-callback');
  return port;
}

function oauthCallbackHandler(state, settle) {
  return (req, res) => {
    let url;
    try {
      url = new URL(req?.url || '/', 'http://127.0.0.1');
    } catch {
      respond(res, 400, 'Authentication failed');
      settle.reject(safeError('OAuth callback was invalid', 'oauth-callback'));
      return;
    }
    if (url.pathname !== '/oauth2callback') {
      respond(res, 404, 'Not found');
      return;
    }
    if (url.searchParams.get('state') !== state) {
      respond(res, 400, 'Authentication failed');
      settle.reject(safeError('OAuth callback state mismatch', 'oauth-callback'));
      return;
    }
    if (url.searchParams.get('error')) {
      respond(res, 400, 'Authentication failed');
      settle.reject(safeError('OAuth authorization was denied', 'oauth-denied'));
      return;
    }
    const code = url.searchParams.get('code');
    if (!code) {
      respond(res, 400, 'Authentication failed');
      settle.reject(safeError('OAuth authorization code was missing', 'oauth-callback'));
      return;
    }
    respond(res, 200, 'Authentication complete. You may close this window.');
    settle.resolve(code);
  };
}

async function authorizeOAuth(options = {}) {
  const files = await loadOAuthFiles({ ...options, requireToken: false });
  const googleApi = googleApiFrom(options);
  const state = options.state || crypto.randomBytes(24).toString('hex');
  let settle;
  const codePromise = new Promise((resolve, reject) => {
    settle = { resolve, reject };
  });
  const serverFactory = options.serverFactory || (handler => http.createServer(handler));
  const server = serverFactory(oauthCallbackHandler(state, settle));
  const scheduleTimeout = options.scheduleTimeout || setTimeout;
  const cancelTimeout = options.cancelTimeout || clearTimeout;
  let timeout;

  try {
    const port = await listenOnLocalhost(server);
    const redirectUri = `http://127.0.0.1:${port}/oauth2callback`;
    const auth = new googleApi.auth.OAuth2(files.clientId, files.clientSecret, redirectUri);
    const authUrl = auth.generateAuthUrl({
      access_type: 'offline',
      prompt: 'consent',
      scope: [GMAIL_SCOPE],
      state,
      redirect_uri: redirectUri,
    });
    timeout = scheduleTimeout(
      () => settle.reject(safeError('OAuth authorization timed out', 'oauth-timeout')),
      options.timeoutMs ?? 120000,
    );
    const launcher = options.launcher || (url => launchAuthorizationUrl(url, options.spawnApi));
    try {
      await launcher(authUrl);
    } catch {
      throw safeError('OAuth authorization browser launch failed', 'oauth-browser');
    }
    const code = await codePromise;
    let tokenResponse;
    try {
      tokenResponse = await auth.getToken(code);
    } catch {
      throw safeError('OAuth token exchange failed', 'oauth-exchange');
    }
    const tokens = tokenResponse?.tokens;
    if (!isValidOAuthToken(tokens)) {
      throw safeError('OAuth token exchange returned no token', 'oauth-exchange');
    }
    try {
      auth.setCredentials(tokens);
      const writer = options.writeJsonAtomic || writeJsonAtomic;
      await writer(files.tokenPath, tokens, options.fsApi || fs);
    } catch {
      throw safeError('OAuth token file write failed', 'oauth-token-write');
    }
    return { ok: true, tokenPath: files.tokenPath };
  } finally {
    if (timeout !== undefined) cancelTimeout(timeout);
    await closeServer(server);
  }
}

function isValidDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function parseCliArgs(argv) {
  if (!Array.isArray(argv)) throw safeError('CLI arguments are invalid', 'cli');
  const parsed = { authOnly: false };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--auth-only') {
      if (parsed.authOnly) throw safeError('duplicate CLI option', 'cli');
      parsed.authOnly = true;
      continue;
    }
    if (token === '--today' || token === '--tasks') {
      const key = token.slice(2);
      if (parsed[key] !== undefined) throw safeError('duplicate CLI option', 'cli');
      const value = argv[index + 1];
      if (typeof value !== 'string' || value.length === 0 || value.startsWith('--')) {
        throw safeError(`missing ${token} value`, 'cli');
      }
      parsed[key] = value;
      index += 1;
      continue;
    }
    throw safeError('unknown CLI argument', 'cli');
  }
  if (parsed.authOnly) {
    if (parsed.today !== undefined || parsed.tasks !== undefined) {
      throw safeError('--auth-only cannot be combined with task options', 'cli');
    }
    return parsed;
  }
  if (parsed.today === undefined || parsed.tasks === undefined) {
    throw safeError('--today and --tasks are required', 'cli');
  }
  if (!isValidDate(parsed.today)) throw safeError('--today must be a valid YYYY-MM-DD date', 'cli');
  return parsed;
}

function resolveTasksPath(value, workDir = DEFAULT_WORK_DIR) {
  const root = path.resolve(workDir);
  const resolved = path.resolve(value);
  const relative = path.relative(root, resolved);
  if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw safeError('tasks保存先は_work内に限定されています', 'input');
  }
  return resolved;
}

async function loadTasksJson(filePath, fsApi) {
  try {
    return await readJsonFile(filePath, fsApi);
  } catch {
    throw safeError(`日次タスクJSONが見つからないか不正です: ${path.resolve(filePath)}。既存のJSONを用意してください。`, 'input');
  }
}

async function runCli(argv = process.argv.slice(2), deps = {}) {
  let authOnly = false;
  const log = deps.log || console.log;
  const errorLog = deps.error || console.error;
  try {
    const args = parseCliArgs(argv);
    authOnly = args.authOnly;
    if (authOnly) {
      const result = await authorizeOAuth({
        fsApi: deps.fsApi,
        clientPath: deps.clientPath,
        tokenPath: deps.tokenPath,
        googleApi: deps.googleApi,
        serverFactory: deps.serverFactory,
        launcher: deps.launcher,
        spawnApi: deps.spawnApi,
        timeoutMs: deps.timeoutMs,
        scheduleTimeout: deps.scheduleTimeout,
        cancelTimeout: deps.cancelTimeout,
        writeJsonAtomic: deps.writeJsonAtomic,
        state: deps.state,
      });
      log(`AUTH_RESULT: OK token=${result.tokenPath}`);
      return 0;
    }

    const fsApi = deps.fsApi || fs;
    const tasksPath = resolveTasksPath(args.tasks, deps.tasksRoot || DEFAULT_WORK_DIR);
    const input = await loadTasksJson(tasksPath, fsApi);
    const createGmail = deps.createAuthorizedGmail || createAuthorizedGmail;
    const gmail = await createGmail({
      fsApi,
      clientPath: deps.clientPath,
      tokenPath: deps.tokenPath,
      googleApi: deps.googleApi,
    });
    const fetcher = deps.fetchVerifiedGmailTasks || fetchVerifiedGmailTasks;
    const gmailResult = await fetcher(gmail, args.today);
    const merger = deps.mergeGmailTasks || mergeGmailTasks;
    const merged = merger(input, gmailResult, args.today);
    const validated = validateDailyTasks(merged, args.today, { requireSection: true });
    const writer = deps.writeJsonAtomic || writeJsonAtomic;
    await writer(tasksPath, validated, fsApi);
    const counts = gmailResult.counts || summarizeTaskCounts(gmailResult.tasks);
    log(`GMAIL_RESULT: OK unique=${gmailResult.uniqueThreads} checked=${gmailResult.checkedThreads}`
      + ` overdue=${counts.overdue} today=${counts.today} upcoming=${counts.upcoming} tasks=${gmailResult.tasks.length}`);
    return 0;
  } catch (error) {
    const prefix = authOnly ? 'AUTH_RESULT' : 'GMAIL_RESULT';
    const type = error?.failureType || (authOnly ? 'auth' : 'internal');
    const detail = error?.safeForCli ? ` ${error.message}` : '';
    errorLog(`${prefix}: ERROR type=${type}${detail}`);
    return 1;
  }
}

function makeTemporaryPath(filePath) {
  const directory = path.dirname(filePath);
  const basename = path.basename(filePath);
  const nonce = crypto.randomBytes(12).toString('hex');
  return path.join(directory, `.${basename}.${process.pid}.${Date.now()}.${nonce}.tmp`);
}

async function writeJsonAtomic(filePath, value, fsApi = fs) {
  const serialized = JSON.stringify(value, null, 2);
  if (typeof serialized !== 'string') throw new Error('JSON serialization failed');

  const api = fsPromises(fsApi);
  const temporaryPath = makeTemporaryPath(filePath);
  let handle;
  try {
    handle = await api.open(temporaryPath, 'wx', 0o600);
    const payload = Buffer.from(`${serialized}\n`, 'utf8');
    const result = await handle.write(payload, 0, payload.length, 0);
    if (result?.bytesWritten != null && result.bytesWritten !== payload.length) {
      throw new Error('temporary JSON write incomplete');
    }
    await handle.sync();
    await handle.close();
    handle = null;
    await api.rename(temporaryPath, filePath);
  } catch (error) {
    if (handle) {
      try { await handle.close(); } catch {}
    }
    try { await api.unlink(temporaryPath); } catch {}
    throw error;
  }
}

module.exports = {
  listAllThreadIds,
  fetchVerifiedGmailTasks,
  mergeGmailTasks,
  writeJsonAtomic,
  loadOAuthFiles,
  createAuthorizedGmail,
  GMAIL_SCOPE,
  DEFAULT_OAUTH_CLIENT_PATH,
  DEFAULT_OAUTH_TOKEN_PATH,
  DEFAULT_WORK_DIR,
  authorizeOAuth,
  parseCliArgs,
  resolveTasksPath,
  runCli,
};

if (require.main === module) {
  runCli(process.argv.slice(2)).then(code => {
    process.exitCode = code;
  });
}
