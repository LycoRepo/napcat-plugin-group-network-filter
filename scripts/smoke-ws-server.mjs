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

async function connectAndRunSmoke(port) {
  const socket = new WebSocket(`ws://127.0.0.1:${port}/`);
  const pending = new Map();
  socket.on('message', (data) => {
    let frame;
    try { frame = JSON.parse(data.toString()); } catch { return; }
    const resolver = pending.get(frame.echo);
    if (resolver) { pending.delete(frame.echo); resolver(frame); }
  });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('等待 WS 生命周期事件超时')), 5000);
    socket.once('error', reject);
    socket.once('message', (data) => {
      clearTimeout(timer);
      try {
        const event = JSON.parse(data.toString());
        if (event.post_type !== 'meta_event' || event.meta_event_type !== 'lifecycle') {
          throw new Error('收到的首个事件不是 OneBot 生命周期事件');
        }
        resolve();
      } catch (error) {
        reject(error);
      }
    });
  });

  // 联系人/别名/安全断言：全部经真实 WS Action 通道执行。
  const sendAction = (payload) => new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`等待 Action ${payload.action} 响应超时`)), 5000);
    pending.set(payload.echo, (frame) => { clearTimeout(timer); resolve(frame); });
    socket.send(JSON.stringify(payload));
  });

  const cases = [
    {
      desc: '名单内联系人经 A 类自动放行 send_private_msg',
      payload: { action: 'send_private_msg', params: { user_id: 22222, message: 'hi' }, echo: 'e1' },
      check: (r) => r.retcode === 0,
    },
    {
      desc: '名单外联系人 send_private_msg 被预检拒绝',
      payload: { action: 'send_private_msg', params: { user_id: 33333, message: 'hi' }, echo: 'e2' },
      check: (r) => r.retcode === 1403 && String(r.message).includes('私聊白名单'),
    },
    {
      desc: '别名 send_like_async 归一化后按 send_like 授权',
      payload: { action: 'send_like_async', params: { user_id: 22222 }, echo: 'e3' },
      check: (r) => r.retcode === 0,
    },
    {
      desc: 'friend_poke 携带 group_id 触发参数熔断（先于显式授权）',
      payload: { action: 'friend_poke', params: { user_id: 22222, group_id: 10001 }, echo: 'e4' },
      check: (r) => r.retcode === 1403 && String(r.message).includes('group_id'),
    },
    {
      desc: 'get_msg 名单外私聊结果被扣留',
      payload: { action: 'get_msg', params: { message_id: 700 }, echo: 'e5' },
      check: (r) => r.retcode === 1403 && r.data == null,
    },
    {
      desc: 'get_msg 名单内私聊结果放行',
      payload: { action: 'get_msg', params: { message_id: 701 }, echo: 'e6' },
      check: (r) => r.retcode === 0 && r.data != null && String(r.data.user_id) === '22222',
    },
    {
      desc: 'get_msg 白名单群结果放行（群边界不变）',
      payload: { action: 'get_msg', params: { message_id: 702 }, echo: 'e7' },
      check: (r) => r.retcode === 0 && r.data != null && String(r.data.group_id) === '10001',
    },
    {
      desc: 'delete_msg 带非白名单群仍被拒绝（群边界不变）',
      payload: { action: 'delete_msg', params: { message_id: 1, group_id: 99999 }, echo: 'e8' },
      check: (r) => r.retcode === 1403,
    },
  ];

  for (const item of cases) {
    const response = await sendAction(item.payload);
    if (!item.check(response)) {
      throw new Error(`${item.desc} 断言失败: ${JSON.stringify(response)}`);
    }
  }
  socket.close();
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
    allowedGroupIds: ['10001'],
    allowedPrivateIds: ['22222'],
    forwardPrivateMessages: true,
    forwardNonGroupEvents: false,
    forwardMetaEvents: true,
    strictActionGuard: true,
    allowedActions: ['send_like', 'get_msg', 'friend_poke'],
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
      call: async (actionName, params = {}) => {
        if (actionName === 'get_login_info') return { user_id: 10000, nickname: 'smoke-test' };
        if (actionName === 'send_private_msg') return { message_id: 1 };
        if (actionName === 'send_like' || actionName === 'send_like_async') return { result: true };
        if (actionName === 'friend_poke') return {};
        if (actionName === 'get_msg') {
          const messageId = String(params.message_id);
          if (messageId === '700') return { message_type: 'private', user_id: 33333, message_id: 700 };
          if (messageId === '701') return { message_type: 'private', user_id: 22222, message_id: 701 };
          if (messageId === '702') return { message_type: 'group', group_id: 10001, message_id: 702 };
        }
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
  await connectAndRunSmoke(port);
  console.log(`WS_SERVER_SMOKE_OK ws://127.0.0.1:${port}/`);
  console.log('WS_SERVER_SECURITY_OK contact-alias-fuse-getmsg');
} finally {
  if (plugin && context) await plugin.plugin_cleanup(context);
  await rm(temporaryDirectory, { recursive: true, force: true });
}
