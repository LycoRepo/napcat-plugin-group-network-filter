import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WebSocketServer } from 'ws';

const temporaryDirectory = await mkdtemp(join(tmpdir(), 'napcat-filter-ws-client-'));
const httpServer = createServer();
const websocketServer = new WebSocketServer({ noServer: true });
let plugin;
let context;

try {
  const handshake = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('等待反向 WS 握手超时')), 5000);
    httpServer.on('upgrade', (request, socket, head) => {
      const expectedHeaders = {
        'x-self-id': '10000',
        'x-client-role': 'Universal',
        'user-agent': 'OneBot/11',
        authorization: 'Bearer smoke-token',
      };
      const mismatch = Object.entries(expectedHeaders)
        .find(([name, value]) => request.headers[name] !== value);
      if (request.url !== '/ws' || mismatch) {
        socket.write('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n');
        socket.destroy();
        clearTimeout(timer);
        reject(new Error(mismatch
          ? `握手请求头不匹配: ${mismatch[0]}`
          : `握手路径不匹配: ${request.url}`));
        return;
      }
      websocketServer.handleUpgrade(request, socket, head, (client) => {
        websocketServer.emit('connection', client, request);
      });
    });
    websocketServer.once('connection', (socket) => {
      const pending = new Map();
      socket.once('message', (data) => {
        try {
          const event = JSON.parse(data.toString());
          if (event.post_type !== 'meta_event' || event.meta_event_type !== 'lifecycle') {
            throw new Error('反向 WS 首帧不是 OneBot 生命周期事件');
          }
          // 联系人安全断言：经真实反向 WS Action 通道执行。
          socket.on('message', (raw) => {
            let frame;
            try { frame = JSON.parse(raw.toString()); } catch { return; }
            const resolver = pending.get(frame.echo);
            if (resolver) { pending.delete(frame.echo); resolver(frame); }
          });
          const cases = [
            {
              desc: '名单外联系人 send_private_msg 被预检拒绝',
              payload: { action: 'send_private_msg', params: { user_id: 33333, message: 'hi' }, echo: 'c1' },
              check: (r) => r.retcode === 1403,
            },
            {
              desc: '名单内联系人 send_private_msg 自动放行',
              payload: { action: 'send_private_msg', params: { user_id: 22222, message: 'hi' }, echo: 'c2' },
              check: (r) => r.retcode === 0,
            },
          ];
          (async () => {
            for (const item of cases) {
              const response = await new Promise((res, rej) => {
                const actionTimer = setTimeout(() => rej(new Error(`等待 Action ${item.payload.action} 响应超时`)), 5000);
                pending.set(item.payload.echo, (frame) => { clearTimeout(actionTimer); res(frame); });
                socket.send(JSON.stringify(item.payload));
              });
              if (!item.check(response)) throw new Error(`${item.desc} 断言失败: ${JSON.stringify(response)}`);
            }
            clearTimeout(timer);
            socket.close();
            resolve();
          })().catch((error) => {
            clearTimeout(timer);
            reject(error);
          });
        } catch (error) {
          clearTimeout(timer);
          reject(error);
        }
      });
    });
  });

  await new Promise((resolve, reject) => {
    httpServer.once('error', reject);
    httpServer.listen(0, '127.0.0.1', resolve);
  });
  const address = httpServer.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  if (!port) throw new Error('无法获取临时测试端口');

  const configPath = join(temporaryDirectory, 'config.json');
  const profile = {
    id: 'smoke-ws-client',
    name: '反向 WS 握手测试',
    enabled: true,
    transport: 'websocket-client',
    url: `ws://127.0.0.1:${port}/ws`,
    accessToken: 'smoke-token',
    allowedGroupIds: [],
    allowedPrivateIds: ['22222'],
    forwardPrivateMessages: true,
    forwardNonGroupEvents: false,
    forwardMetaEvents: true,
    strictActionGuard: true,
    allowedActions: [],
    heartbeatIntervalMs: 0,
    reconnectIntervalMs: 5000,
  };
  await writeFile(configPath, JSON.stringify({
    enabled: true,
    debug: false,
    profilesJson: JSON.stringify([profile]),
  }), 'utf8');

  plugin = await import(`../dist/index.mjs?client-smoke=${Date.now()}`);
  context = {
    actions: {
      call: async (actionName) => {
        if (actionName === 'get_login_info') return { user_id: 10000, nickname: 'smoke-test' };
        if (actionName === 'send_private_msg') return { message_id: 1 };
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
  await handshake;
  console.log(`WS_CLIENT_HANDSHAKE_OK ws://127.0.0.1:${port}/ws`);
  console.log('WS_CLIENT_SECURITY_OK contact-precheck');
} finally {
  if (plugin && context) await plugin.plugin_cleanup(context);
  websocketServer.close();
  await new Promise((resolve) => httpServer.close(resolve));
  await rm(temporaryDirectory, { recursive: true, force: true });
}
