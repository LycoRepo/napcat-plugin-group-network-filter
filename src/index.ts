import type { NapCatPluginContext, PluginModule } from './napcat-api.js';
import { GatewayRuntime } from './runtime.js';
import { ConfigStore } from './state.js';
import type { OneBotEvent } from './types.js';
import { registerWebUi } from './webui.js';

let runtime: GatewayRuntime | undefined;
let store: ConfigStore | undefined;

export const plugin_init: PluginModule['plugin_init'] = async (context: NapCatPluginContext) => {
  context.logger.info('群网络过滤插件正在初始化');
  store = new ConfigStore(context);
  runtime = new GatewayRuntime(context);
  await runtime.restart(store.load());
  registerWebUi(context, store, runtime);
};

export const plugin_onmessage: PluginModule['plugin_onmessage'] = async (_context, event) => {
  runtime?.forwardEvent(event as unknown as OneBotEvent);
};

export const plugin_onevent: PluginModule['plugin_onevent'] = async (_context, event) => {
  const oneBotEvent = event as unknown as OneBotEvent;
  // 某些 NapCat 版本可能同时向两个钩子分派消息，避免重复转发。
  if (oneBotEvent.post_type !== 'message' && oneBotEvent.post_type !== 'message_sent') {
    runtime?.forwardEvent(oneBotEvent);
  }
};

export const plugin_cleanup: PluginModule['plugin_cleanup'] = async (context) => {
  await runtime?.stop();
  runtime = undefined;
  store = undefined;
  context.logger.info('群网络过滤插件已停止');
};

export const napcat = {
  name: '群网络过滤网关',
  description: '按群白名单隔离 OneBot 11 WebSocket 与 HTTP 网络连接',
  version: '0.4.1',
};
