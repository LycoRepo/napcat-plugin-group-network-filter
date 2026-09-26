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

// 帧收集通道：Action 响应按 echo 唤醒，事件帧供 waitFor / assertNone 断言。
function openFrameChannel(socket) {
  const frames = [];
  const waiters = new Set();
  const pending = new Map();
  socket.on('message', (data) => {
    let frame;
    try { frame = JSON.parse(data.toString()); } catch { return; }
    frames.push(frame);
    const resolver = pending.get(frame.echo);
    if (resolver) { pending.delete(frame.echo); resolver(frame); }
    for (const waiter of [...waiters]) waiter(frame);
  });
  return {
    frames,
    sendAction(payload) {
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`等待 Action ${payload.action} 响应超时`)), 5000);
        pending.set(payload.echo, (frame) => { clearTimeout(timer); resolve(frame); });
        socket.send(JSON.stringify(payload));
      });
    },
    waitFor(match, description, timeoutMs = 3000) {
      if (frames.some(match)) return Promise.resolve();
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => { waiters.delete(waiter); reject(new Error(`等待${description}超时`)); }, timeoutMs);
        const waiter = (frame) => {
          if (!match(frame)) return;
          clearTimeout(timer);
          waiters.delete(waiter);
          resolve();
        };
        waiters.add(waiter);
      });
    },
    async assertNone(match, description, windowMs = 400) {
      await new Promise((resolve) => setTimeout(resolve, windowMs));
      if (frames.some(match)) throw new Error(`${description}：事件不应被转发但已到达`);
    },
    close() {
      socket.close();
    },
  };
}

async function connectSmoke(port) {
  const socket = new WebSocket(`ws://127.0.0.1:${port}/`);
  const channel = openFrameChannel(socket);
  const isLifecycle = (frame) => frame.post_type === 'meta_event' && frame.meta_event_type === 'lifecycle';
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('等待 WS 生命周期事件超时')), 5000);
    socket.once('error', reject);
    channel.waitFor(isLifecycle, 'WS 生命周期事件').then(
      () => { clearTimeout(timer); resolve(); },
      (error) => { clearTimeout(timer); reject(error); },
    );
  });
  if (!isLifecycle(channel.frames[0])) throw new Error('收到的首个事件不是 OneBot 生命周期事件');
  return channel;
}

// 联系人/别名/安全断言：全部经真实 WS Action 通道执行。
async function runActionCases(channel) {
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
    {
      desc: 'friend_poke 名单内目标且已授权时放行',
      payload: { action: 'friend_poke', params: { user_id: 22222 }, echo: 'e9' },
      check: (r) => r.retcode === 0,
    },
    {
      desc: 'get_msg 私聊结果 user_id 等于 self_id 被扣留（fail-closed）',
      payload: { action: 'get_msg', params: { message_id: 703 }, echo: 'e10' },
      check: (r) => r.retcode === 1403 && r.data == null && String(r.message).includes('自身'),
    },
    {
      desc: 'set_input_status 名单内目标但未授权时给出准确拒绝理由',
      payload: { action: 'set_input_status', params: { user_id: 22222 }, echo: 'e11' },
      check: (r) => r.retcode === 1403 && String(r.message).includes('allowedActions'),
    },
    {
      desc: 'send_msg 私聊形态命中名单自动放行（不进群路径）',
      payload: { action: 'send_msg', params: { user_id: 22222, message: 'hi' }, echo: 'e12' },
      check: (r) => r.retcode === 0,
    },
    {
      desc: 'send_msg 群形态走 group_id 白名单分支',
      payload: { action: 'send_msg', params: { message_type: 'group', group_id: 10001, message: 'hi' }, echo: 'e13' },
      check: (r) => r.retcode === 0,
    },
  ];

  for (const item of cases) {
    const response = await channel.sendAction(item.payload);
    if (!item.check(response)) {
      throw new Error(`${item.desc} 断言失败: ${JSON.stringify(response)}`);
    }
  }
}

// message_sent 入站过滤断言：私聊 message_sent 必须按 target_id 判定对端联系人。
async function runMessageSentCases(pluginApi, context, channelA, channelB) {
  const injectSent = (tag, extra) => pluginApi.plugin_onmessage(context, {
    post_type: 'message_sent',
    message_type: 'private',
    self_id: 10000,
    user_id: 10000,
    message_id: 9000,
    time: 1700000000,
    ...extra,
    smoke_tag: tag,
  });

  // 1. 名单非空 + target_id 在名单内 → 转发。
  await injectSent('sent-target-in-list', { target_id: 22222 });
  await channelA.waitFor((frame) => frame.smoke_tag === 'sent-target-in-list', '名单内 target_id 的 message_sent 转发');

  // 2. 名单非空 + target_id 不在名单内 → 不转发；空名单对照配置仍转发，证明注入事件确实生效。
  await injectSent('sent-target-out-list', { target_id: 33333 });
  await channelB.waitFor((frame) => frame.smoke_tag === 'sent-target-out-list', '空名单对照配置的 message_sent 转发');
  await channelA.assertNone((frame) => frame.smoke_tag === 'sent-target-out-list', '名单外 target_id 的 message_sent');

  // 3. 名单非空 + 缺少 target_id → 不转发（fail-closed）。
  await injectSent('sent-no-target', {});
  await channelA.assertNone((frame) => frame.smoke_tag === 'sent-no-target', '缺少 target_id 的 message_sent');

  // 4. 名单为空 + forwardPrivateMessages=true → message_sent 保持旧行为全部转发。
  await injectSent('sent-legacy-all', { target_id: 99999 });
  await channelB.waitFor((frame) => frame.smoke_tag === 'sent-legacy-all', '空名单 message_sent 保持旧行为转发');
}

const temporaryDirectory = await mkdtemp(join(tmpdir(), 'napcat-filter-smoke-'));
let plugin;
let context;
// 控制 get_login_info 模拟是否可用：第二阶段令其失败以获得 selfId=0。
let loginAvailable = true;

try {
  const portA = await getFreePort();
  const portB = await getFreePort();
  const configPath = join(temporaryDirectory, 'config.json');
  const profileA = {
    id: 'smoke-ws-server',
    name: 'WS 服务端冒烟测试',
    enabled: true,
    transport: 'websocket-server',
    host: '127.0.0.1',
    port: portA,
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
  // 名单为空的旧兼容对照配置：message_sent 应保持旧行为全部转发。
  const profileB = {
    id: 'smoke-ws-server-legacy',
    name: 'WS 服务端空名单对照',
    enabled: true,
    transport: 'websocket-server',
    host: '127.0.0.1',
    port: portB,
    accessToken: '',
    allowedGroupIds: [],
    allowedPrivateIds: [],
    forwardPrivateMessages: true,
    forwardNonGroupEvents: false,
    forwardMetaEvents: true,
    strictActionGuard: true,
    allowedActions: [],
    heartbeatIntervalMs: 0,
  };
  await writeFile(configPath, JSON.stringify({
    enabled: true,
    debug: false,
    profilesJson: JSON.stringify([profileA, profileB]),
  }), 'utf8');

  plugin = await import(`../dist/index.mjs?smoke=${Date.now()}`);
  context = {
    actions: {
      call: async (actionName, params = {}) => {
        if (actionName === 'get_login_info') {
          if (!loginAvailable) throw new Error('冒烟测试模拟登录信息不可用');
          return { user_id: 10000, nickname: 'smoke-test' };
        }
        if (actionName === 'send_private_msg') return { message_id: 1 };
        if (actionName === 'send_msg') return { message_id: 2 };
        if (actionName === 'send_like' || actionName === 'send_like_async') return { result: true };
        if (actionName === 'friend_poke') return {};
        if (actionName === 'get_msg') {
          const messageId = String(params.message_id);
          if (messageId === '700') return { message_type: 'private', user_id: 33333, message_id: 700 };
          if (messageId === '701') return { message_type: 'private', user_id: 22222, message_id: 701 };
          if (messageId === '702') return { message_type: 'group', group_id: 10001, message_id: 702 };
          if (messageId === '703') return { message_type: 'private', user_id: 10000, message_id: 703 };
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
  const channelA = await connectSmoke(portA);
  const channelB = await connectSmoke(portB);
  await runActionCases(channelA);
  await runMessageSentCases(plugin, context, channelA, channelB);
  channelA.close();
  channelB.close();
  await plugin.plugin_cleanup(context);

  // 第二阶段：登录信息不可用（selfId 保持 0）时 get_msg 私聊结果必须 fail-closed 扣留。
  loginAvailable = false;
  const portC = await getFreePort();
  await writeFile(configPath, JSON.stringify({
    enabled: true,
    debug: false,
    profilesJson: JSON.stringify([{ ...profileA, id: 'smoke-ws-server-selfid', name: 'WS 服务端 selfId 不可用冒烟', port: portC }]),
  }), 'utf8');
  await plugin.plugin_init(context);
  const channelC = await connectSmoke(portC);
  const selfIdResponse = await channelC.sendAction({ action: 'get_msg', params: { message_id: 701 }, echo: 'e14' });
  if (!(selfIdResponse.retcode === 1403 && selfIdResponse.data == null && String(selfIdResponse.message).includes('selfId'))) {
    throw new Error(`selfId 不可用时 get_msg 私聊结果应被扣留: ${JSON.stringify(selfIdResponse)}`);
  }
  channelC.close();
  await plugin.plugin_cleanup(context);

  console.log(`WS_SERVER_SMOKE_OK ws://127.0.0.1:${portA}/`);
  console.log('WS_SERVER_SECURITY_OK contact-alias-fuse-getmsg-sent-selfid');
} finally {
  if (plugin && context) await plugin.plugin_cleanup(context);
  await rm(temporaryDirectory, { recursive: true, force: true });
}
