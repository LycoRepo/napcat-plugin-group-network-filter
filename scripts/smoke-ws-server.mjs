import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import WebSocket from 'ws';

async function getFreePort() {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  await new Promise((resolve) => server.close(resolve));
  if (!port) throw new Error('无法获取临时测试端口');
  return port;
}

async function connectAndReceiveLifecycle(port) {
  const socket = new WebSocket(`ws://127.0.0.1:${port}/`);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('等待 WS 生命周期事件超时')), 5000);
    socket.once('error', reject);
    socket.once('message', (data) => {
      clearTimeout(timer);
      try {
        const event = JSON.parse(data.toString());
        if (event.post_type !== 'meta_event' || event.meta_event_type !== 'lifecycle') {
          throw new Error('收到的首个事件不是 OneBot 生命周期事件');
        }
        socket.close();
        resolve();
      } catch (error) {
        reject(error);
      }
    });
  });
}

const temporaryDirectory = await mkdtemp(join(tmpdir(), 'napcat-filter-smoke-'));
let plugin;
let context;

try {
  const port = await getFreePort();
  const configPath = join(temporaryDirectory, 'config.json');
  const profile = {
    id: 'smoke-ws-server',
    name: 'WS 服务端冒烟测试',
    enabled: true,
    transport: 'websocket-server',
    host: '127.0.0.1',
    port,
    accessToken: '',
    allowedGroupIds: [],
    forwardPrivateMessages: false,
    forwardNonGroupEvents: false,
    forwardMetaEvents: true,
    strictActionGuard: true,
    allowedActions: [],
    heartbeatIntervalMs: 0,
  };
  await writeFile(configPath, JSON.stringify({
    enabled: true,
    debug: false,
    profilesJson: JSON.stringify([profile]),
  }), 'utf8');

  plugin = await import(`../dist/index.mjs?smoke=${Date.now()}`);
  context = {
    actions: {
      call: async (actionName) => {
        if (actionName === 'get_login_info') return { user_id: 10000, nickname: 'smoke-test' };
        throw new Error(`冒烟测试未模拟 Action: ${actionName}`);
      },
    },
    pluginName: 'napcat-plugin-group-network-filter',
    pluginPath: temporaryDirectory,
    configPath,
    dataPath: temporaryDirectory,
    adapterName: 'smoke-test',
    pluginManager: { config: {} },
    logger: { log() {}, debug() {}, info() {}, warn() {}, error() {} },
    router: { get() {}, post() {}, page() {} },
  };

  await plugin.plugin_init(context);
  await connectAndReceiveLifecycle(port);
  console.log(`WS_SERVER_SMOKE_OK ws://127.0.0.1:${port}/`);
} finally {
  if (plugin && context) await plugin.plugin_cleanup(context);
  await rm(temporaryDirectory, { recursive: true, force: true });
}
