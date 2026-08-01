import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const temporaryDirectory = await mkdtemp(join(tmpdir(), 'napcat-filter-preview-'));
const configPath = join(temporaryDirectory, 'config.json');
await writeFile(configPath, JSON.stringify({ enabled: false, debug: false, profilesJson: '[]' }), 'utf8');

const plugin = await import(`../dist/index.mjs?preview=${Date.now()}`);
const context = {
  actions: { call: async () => ({ user_id: 10000 }) },
  pluginName: 'napcat-plugin-group-network-filter',
  pluginPath: temporaryDirectory,
  configPath,
  dataPath: temporaryDirectory,
  adapterName: 'preview',
  pluginManager: { config: {} },
  logger: { log() {}, debug() {}, info() {}, warn() {}, error() {} },
  router: { get() {}, post() {}, page() {} },
};
await plugin.plugin_init(context);
const html = await readFile(join(temporaryDirectory, 'group-network-filter-webui.html'), 'utf8');

let previewState = {
  enabled: true,
  debug: false,
  activeTransportCount: 2,
  profiles: [
    {
      id: 'preview-astrbot', name: 'AstrBot', enabled: true, transport: 'websocket-client',
      host: '127.0.0.1', port: 3001, path: '/', url: 'ws://astrbot:6199/ws', accessToken: 'preview-token',
      allowedGroupIds: ['123456789', '987654321'], forwardPrivateMessages: false,
      forwardNonGroupEvents: false, forwardMetaEvents: true, strictActionGuard: true,
      allowedActions: [], heartbeatIntervalMs: 15000, reconnectIntervalMs: 5000,
      requestTimeoutMs: 10000, maxPendingEvents: 1000, headers: {},
    },
    {
      id: 'preview-server', name: '本地调试服务', enabled: true, transport: 'websocket-server',
      host: '127.0.0.1', port: 3001, path: '/', url: '', accessToken: '',
      allowedGroupIds: ['123456789'], forwardPrivateMessages: false,
      forwardNonGroupEvents: false, forwardMetaEvents: true, strictActionGuard: true,
      allowedActions: [], heartbeatIntervalMs: 15000, reconnectIntervalMs: 5000,
      requestTimeoutMs: 10000, maxPendingEvents: 1000, headers: {},
    },
  ],
};

function json(response, status, value) {
  const body = JSON.stringify(value);
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  response.end(body);
}

const server = createServer(async (request, response) => {
  if (request.url === '/' || request.url === '/index.html') {
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    response.end(html);
    return;
  }
  if (request.url === '/api/Plugin/ext/napcat-plugin-group-network-filter/config' && request.method === 'GET') {
    json(response, 200, { success: true, data: previewState });
    return;
  }
  if (request.url === '/api/Plugin/ext/napcat-plugin-group-network-filter/config' && request.method === 'POST') {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    previewState = {
      enabled: !!body.enabled,
      debug: !!body.debug,
      profiles: Array.isArray(body.profiles) ? body.profiles : [],
      activeTransportCount: body.enabled ? body.profiles.filter((profile) => profile.enabled).length : 0,
    };
    json(response, 200, { success: true, data: previewState });
    return;
  }
  response.writeHead(404);
  response.end('Not Found');
});

await new Promise((resolve, reject) => {
  server.once('error', reject);
  server.listen(4179, '127.0.0.1', resolve);
});
console.log('WEBUI_PREVIEW_READY http://127.0.0.1:4179/');

async function cleanup() {
  await plugin.plugin_cleanup(context);
  await new Promise((resolve) => server.close(resolve));
  await rm(temporaryDirectory, { recursive: true, force: true });
}
process.once('SIGINT', () => cleanup().finally(() => process.exit(0)));
process.once('SIGTERM', () => cleanup().finally(() => process.exit(0)));
