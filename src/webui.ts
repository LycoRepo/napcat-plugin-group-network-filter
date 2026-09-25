import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { NapCatPluginContext, PluginHttpResponse } from './napcat-api.js';
import { parseProfiles, validateProfiles } from './config.js';
import type { GatewayRuntime } from './runtime.js';
import type { ConfigStore } from './state.js';
import type { PluginConfig } from './types.js';

const WEBUI_FILE_NAME = 'group-network-filter-webui.html';
const PLUGIN_ID = 'napcat-plugin-group-network-filter';

function asObject(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function toWebUiConfig(config: PluginConfig, runtime: GatewayRuntime) {
  return {
    enabled: config.enabled,
    debug: config.debug,
    profiles: parseProfiles(config.profilesJson),
    activeTransportCount: runtime.getActiveTransportCount(),
  };
}

function sendError(response: PluginHttpResponse, error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  response.status(400).json({ success: false, message });
}

export function registerWebUi(
  context: NapCatPluginContext,
  store: ConfigStore,
  runtime: GatewayRuntime,
): void {
  const htmlPath = resolve(context.pluginPath, WEBUI_FILE_NAME);
  try {
    writeFileSync(htmlPath, createWebUiHtml(PLUGIN_ID), 'utf8');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    context.logger.error(`生成 WebUI 页面失败: ${message}`);
    return;
  }

  context.router.get('/config', (_request, response) => {
    try {
      response.json({ success: true, data: toWebUiConfig(store.get(), runtime) });
    } catch (error) {
      sendError(response, error);
    }
  });

  context.router.post('/config', async (request, response) => {
    try {
      const body = asObject(request.body);
      const profiles = validateProfiles(body.profiles ?? []);
      const savedConfig = store.save({
        enabled: typeof body.enabled === 'boolean' ? body.enabled : true,
        debug: typeof body.debug === 'boolean' ? body.debug : false,
        profilesJson: JSON.stringify(profiles, null, 2),
      });
      await runtime.restart(savedConfig);
      response.json({ success: true, data: toWebUiConfig(savedConfig, runtime) });
    } catch (error) {
      sendError(response, error);
    }
  });

  context.router.page({
    path: 'group-network-filter',
    title: '群网络过滤',
    icon: '🔐',
    htmlFile: WEBUI_FILE_NAME,
    description: '可视化管理按群白名单隔离的 OneBot 网络连接',
  });
}

function createWebUiHtml(pluginId: string): string {
  const pluginIdJson = JSON.stringify(pluginId);
  return String.raw`<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>群网络过滤网关</title>
  <style>
    :root {
      color-scheme: light dark;
      --bg: #f3f6fb;
      --surface: rgba(255,255,255,.94);
      --surface-solid: #fff;
      --surface-2: #f1f5f9;
      --text: #142033;
      --muted: #69778d;
      --line: #dce4ef;
      --primary: #2563eb;
      --primary-hover: #1d4ed8;
      --success: #16834c;
      --danger: #dc2626;
      --warning-bg: #fff7df;
      --warning-text: #7c5200;
      --shadow: 0 16px 42px rgba(31,51,79,.09);
      --modal-shadow: 0 30px 90px rgba(0,0,0,.28);
      --radius: 16px;
    }
    @media (prefers-color-scheme: dark) {
      :root {
        --bg: #0c1320;
        --surface: rgba(22,31,48,.95);
        --surface-solid: #161f30;
        --surface-2: #1b273a;
        --text: #e7edf7;
        --muted: #9daac0;
        --line: #2d3b51;
        --primary: #5b8cff;
        --primary-hover: #7ba3ff;
        --success: #57d193;
        --danger: #ff7373;
        --warning-bg: #352a13;
        --warning-text: #f7d47b;
        --shadow: 0 18px 50px rgba(0,0,0,.28);
      }
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100vh;
      font: 14px/1.5 Inter, "Microsoft YaHei", system-ui, sans-serif;
      color: var(--text);
      background: radial-gradient(circle at 0 0, rgba(37,99,235,.12), transparent 30rem), var(--bg);
    }
    button, input, select, textarea { font: inherit; }
    button { cursor: pointer; }
    .hidden { display: none !important; }
    .shell { width: min(1180px, calc(100% - 32px)); margin: 0 auto; padding: 28px 0 72px; }
    .topbar { display: flex; align-items: flex-start; justify-content: space-between; gap: 20px; margin-bottom: 20px; }
    h1 { margin: 0; font-size: clamp(25px,4vw,34px); letter-spacing: -.035em; }
    .subtitle { margin: 7px 0 0; color: var(--muted); }
    .top-actions { display: flex; gap: 10px; }
    .button {
      min-height: 40px;
      padding: 9px 15px;
      border: 1px solid var(--line);
      border-radius: 11px;
      color: var(--text);
      background: var(--surface);
      transition: .16s ease;
      box-shadow: 0 3px 10px rgba(0,0,0,.03);
    }
    .button:hover { transform: translateY(-1px); border-color: var(--primary); }
    .button.primary { color: #fff; background: var(--primary); border-color: var(--primary); font-weight: 700; }
    .button.primary:hover { background: var(--primary-hover); }
    .button.danger { color: var(--danger); }
    .button.small { min-height: 34px; padding: 6px 10px; }
    .button.icon { width: 38px; min-height: 38px; padding: 0; font-size: 19px; }
    .button:disabled { opacity: .55; cursor: wait; transform: none; }
    .banner {
      margin-bottom: 18px;
      padding: 13px 16px;
      border: 1px solid color-mix(in srgb,var(--warning-text) 30%,transparent);
      border-radius: 13px;
      color: var(--warning-text);
      background: var(--warning-bg);
    }
    .panel, .config-card {
      border: 1px solid var(--line);
      border-radius: var(--radius);
      background: var(--surface);
      box-shadow: var(--shadow);
      backdrop-filter: blur(14px);
    }
    .global-panel { display: grid; grid-template-columns: 1fr 1fr auto; align-items: center; gap: 18px; padding: 18px; }
    .setting-line { display: flex; align-items: center; gap: 12px; }
    .setting-copy strong { display: block; }
    .setting-copy span { display: block; color: var(--muted); font-size: 12px; }
    .status { text-align: right; color: var(--muted); }
    .status strong { display: block; color: var(--success); font-size: 21px; }
    .switch { position: relative; flex: 0 0 auto; width: 44px; height: 24px; }
    .switch input { opacity: 0; width: 0; height: 0; }
    .slider { position: absolute; inset: 0; border-radius: 999px; background: #98a5b6; transition: .18s; }
    .slider:before { content: ""; position: absolute; width: 18px; height: 18px; left: 3px; top: 3px; border-radius: 50%; background: #fff; transition: .18s; box-shadow: 0 1px 4px rgba(0,0,0,.25); }
    .switch input:checked + .slider { background: var(--primary); }
    .switch input:checked + .slider:before { transform: translateX(20px); }
    .switch input:disabled + .slider { opacity: .55; }
    .section-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin: 24px 0 14px; }
    .section-head h2 { margin: 0; font-size: 20px; }
    .section-head span { color: var(--muted); font-size: 12px; }
    .cards { display: grid; grid-template-columns: repeat(2,minmax(0,1fr)); gap: 16px; }
    .config-card { position: relative; overflow: hidden; padding: 18px; transition: transform .18s,border-color .18s,opacity .18s; }
    .config-card:hover { transform: translateY(-2px); border-color: color-mix(in srgb,var(--primary) 45%,var(--line)); }
    .config-card.disabled { opacity: .68; }
    .card-head { display: flex; align-items: flex-start; gap: 12px; }
    .card-title { min-width: 0; flex: 1; }
    .card-title h3 { margin: 9px 0 4px; font-size: 17px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .endpoint { display: block; color: var(--muted); font: 12px/1.5 ui-monospace,SFMono-Regular,Consolas,monospace; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .badge { display: inline-flex; padding: 4px 8px; border-radius: 999px; color: var(--primary); background: color-mix(in srgb,var(--primary) 13%,transparent); font-size: 12px; font-weight: 700; }
    .card-stats { display: grid; grid-template-columns: repeat(4,1fr); gap: 8px; margin: 17px 0; }
    .stat { padding: 10px; border-radius: 10px; background: var(--surface-2); }
    .stat strong { display: block; font-size: 14px; }
    .stat span { color: var(--muted); font-size: 11px; }
    .card-actions { display: flex; gap: 8px; border-top: 1px solid var(--line); padding-top: 14px; }
    .card-actions .button { flex: 1; }
    .add-card { min-height: 238px; border: 2px dashed var(--line); border-radius: var(--radius); background: transparent; color: var(--muted); display: grid; place-items: center; text-align: center; transition: .18s; }
    .add-card:hover { color: var(--primary); border-color: var(--primary); background: color-mix(in srgb,var(--primary) 5%,transparent); }
    .add-card .plus { display: block; margin: 0 auto 8px; font-size: 38px; line-height: 1; }
    .empty { grid-column: 1/-1; padding: 55px 20px; text-align: center; color: var(--muted); }
    .empty strong { display: block; color: var(--text); font-size: 17px; margin-bottom: 5px; }
    .loading { padding: 70px 20px; text-align: center; color: var(--muted); }
    .modal-backdrop { position: fixed; inset: 0; z-index: 100; display: flex; align-items: center; justify-content: center; padding: 22px; background: rgba(5,10,20,.58); backdrop-filter: blur(5px); }
    .modal { width: min(820px,100%); max-height: calc(100vh - 44px); display: flex; flex-direction: column; border: 1px solid var(--line); border-radius: 18px; background: var(--surface-solid); box-shadow: var(--modal-shadow); overflow: hidden; }
    .modal-head { display: flex; align-items: center; gap: 12px; padding: 17px 20px; border-bottom: 1px solid var(--line); }
    .modal-head div { flex: 1; }
    .modal-head h2 { margin: 0; font-size: 19px; }
    .modal-head p { margin: 3px 0 0; color: var(--muted); font-size: 12px; }
    .modal-body { padding: 20px; overflow: auto; }
    .modal-footer { display: flex; justify-content: flex-end; gap: 10px; padding: 15px 20px; border-top: 1px solid var(--line); background: var(--surface-2); }
    .form-section + .form-section { margin-top: 22px; padding-top: 18px; border-top: 1px solid var(--line); }
    .form-section h3 { margin: 0 0 13px; font-size: 15px; }
    .grid { display: grid; grid-template-columns: repeat(12,1fr); gap: 14px; }
    .field { grid-column: span 6; min-width: 0; }
    .field.third { grid-column: span 4; }
    .field.full { grid-column: 1/-1; }
    .field label { display: block; margin-bottom: 6px; font-weight: 650; }
    .hint { margin-top: 5px; color: var(--muted); font-size: 12px; }
    input[type=text], input[type=number], select, textarea {
      width: 100%; padding: 10px 11px; border: 1px solid var(--line); border-radius: 10px; outline: none; color: var(--text); background: var(--surface-2); transition: border-color .15s,box-shadow .15s;
    }
    textarea { min-height: 90px; resize: vertical; font-family: ui-monospace,SFMono-Regular,Consolas,monospace; }
    input:focus, select:focus, textarea:focus { border-color: var(--primary); box-shadow: 0 0 0 3px color-mix(in srgb,var(--primary) 18%,transparent); }
    .checks { display: grid; grid-template-columns: repeat(2,minmax(0,1fr)); gap: 10px; }
    .check { display: flex; align-items: flex-start; gap: 9px; padding: 11px; border: 1px solid var(--line); border-radius: 10px; background: var(--surface-2); }
    .check input { margin-top: 3px; }
    .check strong { display: block; }
    .check span { display: block; color: var(--muted); font-size: 12px; }
    details { margin-top: 12px; }
    summary { cursor: pointer; color: var(--muted); font-weight: 700; }
    details .field { margin-top: 12px; }
    .toast { position: fixed; right: 22px; bottom: 22px; z-index: 200; max-width: min(420px,calc(100% - 44px)); padding: 12px 16px; border-radius: 11px; color: #fff; background: #142033; box-shadow: var(--shadow); opacity: 0; transform: translateY(12px); pointer-events: none; transition: .2s; }
    .toast.show { opacity: 1; transform: translateY(0); }
    .toast.error { background: #991b1b; }
    @media (max-width: 780px) {
      .shell { width: min(100% - 20px,1180px); padding-top: 18px; }
      .topbar { flex-direction: column; }
      .global-panel { grid-template-columns: 1fr; }
      .status { text-align: left; }
      .cards { grid-template-columns: 1fr; }
      .field,.field.third { grid-column: 1/-1; }
      .checks { grid-template-columns: 1fr; }
      .modal-backdrop { padding: 8px; }
      .modal { max-height: calc(100vh - 16px); border-radius: 13px; }
    }
  </style>
</head>
<body>
  <main class="shell">
    <header class="topbar">
      <div>
        <h1>群网络过滤网关</h1>
        <p class="subtitle">每条连接独立设置群白名单，只有允许的事件才会到达目标服务。</p>
      </div>
      <div class="top-actions"><button id="reload" class="button">重新加载</button></div>
    </header>

    <div class="banner">启用插件连接后，请关闭 NapCat 中指向同一服务的原生直连配置，否则其他群事件仍可能绕过过滤。</div>

    <section class="panel global-panel">
      <div class="setting-line">
        <label class="switch"><input id="enabled" type="checkbox"><span class="slider"></span></label>
        <div class="setting-copy"><strong>启用过滤网关</strong><span>切换后立即保存并重载全部连接</span></div>
      </div>
      <div class="setting-line">
        <label class="switch"><input id="debug" type="checkbox"><span class="slider"></span></label>
        <div class="setting-copy"><strong>调试日志</strong><span>输出连接和过滤相关的详细日志</span></div>
      </div>
      <div class="status"><strong id="active-count">0</strong>个活动连接</div>
    </section>

    <div class="section-head">
      <div><h2>网络配置</h2><span id="profile-count">0 条配置</span></div>
      <button id="add" class="button primary">＋ 新增配置</button>
    </div>
    <section id="cards" class="cards"><div class="panel loading">正在读取插件配置…</div></section>
  </main>

  <div id="modal-backdrop" class="modal-backdrop hidden" role="dialog" aria-modal="true" aria-labelledby="modal-title">
    <form id="profile-form" class="modal">
      <div class="modal-head">
        <div><h2 id="modal-title">新增网络配置</h2><p>保存后立即重载相关网络连接</p></div>
        <button id="modal-close" class="button icon" type="button" aria-label="关闭">×</button>
      </div>
      <div class="modal-body">
        <section class="form-section">
          <h3>基本信息</h3>
          <div class="grid">
            <div class="field"><label for="profile-name">配置名称</label><input id="profile-name" name="name" type="text" required placeholder="例如 AstrBot"></div>
            <div class="field"><label for="profile-transport">网络协议</label><select id="profile-transport" name="transport">
              <option value="websocket-client">反向 WebSocket · 客户端</option>
              <option value="websocket-server">正向 WebSocket · 服务端</option>
              <option value="http-client">反向 HTTP · 事件推送</option>
              <option value="http-server">正向 HTTP · Action 服务端</option>
            </select></div>
          </div>
        </section>

        <section class="form-section">
          <h3>连接参数</h3>
          <div class="grid">
            <div id="url-field" class="field full"><label for="profile-url">目标 URL</label><input id="profile-url" name="url" type="text" placeholder="ws://127.0.0.1:6199/ws"><div id="url-hint" class="hint"></div></div>
            <div id="host-field" class="field"><label for="profile-host">监听地址</label><input id="profile-host" name="host" type="text" placeholder="127.0.0.1"><div class="hint">仅本机使用建议填写 127.0.0.1</div></div>
            <div id="port-field" class="field"><label for="profile-port">监听端口</label><input id="profile-port" name="port" type="number" min="1" max="65535"></div>
            <div class="field full"><label for="profile-token">Access Token</label><input id="profile-token" name="accessToken" type="text" autocomplete="off"><div class="hint">Token 以明文显示；公网或非可信网络必须设置</div></div>
            <div id="heartbeat-field" class="field"><label for="profile-heartbeat">心跳间隔（毫秒）</label><input id="profile-heartbeat" name="heartbeatIntervalMs" type="number" min="0"><div class="hint">仅 WebSocket 使用，0 表示关闭</div></div>
            <div id="reconnect-field" class="field"><label for="profile-reconnect">重连间隔（毫秒）</label><input id="profile-reconnect" name="reconnectIntervalMs" type="number" min="500"><div class="hint">仅反向 WebSocket 使用</div></div>
          </div>
        </section>

        <section class="form-section">
          <h3>群白名单与权限</h3>
          <div class="grid">
            <div class="field full"><label for="profile-groups">允许的群号</label><textarea id="profile-groups" name="allowedGroupIds" placeholder="每行填写一个群号，也支持逗号或空格分隔"></textarea><div class="hint">空列表表示不允许任何群，而不是允许全部群</div></div>
            <div class="field full"><label for="profile-private-contacts">允许的私聊联系人</label><textarea id="profile-private-contacts" name="allowedPrivateIds" placeholder="每行填写一个 QQ 号，也支持逗号或空格分隔"></textarea><div class="hint">仅控制私聊转发与私聊 Action。留空表示沿用旧行为，放行全部私聊入站，也不会自动放行任何私聊 Action。需要机器人在私聊中回复某位联系人时，必须把该 QQ 号填入此名单。</div></div>
            <div class="field full"><div class="checks">
              <label class="check"><input id="profile-private" name="forwardPrivateMessages" type="checkbox"><div><strong>转发私聊消息</strong><span>允许目标服务接收私聊事件</span></div></label>
              <label class="check"><input id="profile-events" name="forwardNonGroupEvents" type="checkbox"><div><strong>转发非群事件</strong><span>转发不含 group_id 的通知和请求</span></div></label>
              <label class="check"><input id="profile-meta" name="forwardMetaEvents" type="checkbox"><div><strong>转发元事件</strong><span>转发生命周期、状态和心跳</span></div></label>
              <label class="check"><input id="profile-strict" name="strictActionGuard" type="checkbox"><div><strong>严格 Action 限制</strong><span>仅允许目标服务操作白名单群</span></div></label>
            </div></div>
            <div class="field full"><details><summary>高级权限设置</summary><div class="field full"><label for="profile-actions">额外放行的 Action</label><textarea id="profile-actions" name="allowedActions" placeholder="每行一个 Action 名称"></textarea><div class="hint">放行敏感 Action 可能扩大目标服务的数据访问范围</div></div></details></div>
          </div>
        </section>
      </div>
      <footer class="modal-footer">
        <button id="modal-cancel" class="button" type="button">取消</button>
        <button id="modal-save" class="button primary" type="submit">保存</button>
      </footer>
    </form>
  </div>

  <div id="toast" class="toast"></div>

  <script>
    (function () {
      'use strict';
      var pluginId = ${pluginIdJson};
      var apiBase = '/api/Plugin/ext/' + encodeURIComponent(pluginId);
      var state = { enabled: true, debug: false, profiles: [], activeTransportCount: 0 };
      var busy = false;
      var editingIndex = null;
      var editingProfile = null;
      var modalInitialSnapshot = '';

      var labels = {
        'websocket-client': '反向 WebSocket · 客户端',
        'websocket-server': '正向 WebSocket · 服务端',
        'http-client': '反向 HTTP · 事件推送',
        'http-server': '正向 HTTP · Action 服务端'
      };

      function esc(value) {
        return String(value == null ? '' : value)
          .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
          .replace(/"/g,'&quot;').replace(/'/g,'&#039;');
      }

      function splitList(value) {
        return String(value || '').split(/[\s,，;；]+/).map(function (item) { return item.trim(); }).filter(Boolean)
          .filter(function (item,index,list) { return list.indexOf(item) === index; });
      }

      function idFor(transport) {
        return transport.replace(/[^a-z]+/g,'-') + '-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2,7);
      }

      function defaultProfile(transport) {
        var isWs = /^websocket/.test(transport);
        return {
          id: idFor(transport),
          name: labels[transport],
          enabled: true,
          transport: transport,
          host: '127.0.0.1',
          port: isWs ? 3001 : 3002,
          path: '/',
          url: transport === 'websocket-client' ? 'ws://127.0.0.1:6199/ws' : transport === 'http-client' ? 'http://127.0.0.1:8080/onebot/events' : '',
          accessToken: '',
          allowedGroupIds: [],
          allowedPrivateIds: [],
          forwardPrivateMessages: false,
          forwardNonGroupEvents: false,
          forwardMetaEvents: true,
          strictActionGuard: true,
          allowedActions: [],
          heartbeatIntervalMs: isWs ? 15000 : 0,
          reconnectIntervalMs: 5000,
          requestTimeoutMs: 10000,
          maxPendingEvents: 1000,
          headers: {}
        };
      }

      function normalizeProfile(profile) {
        var result = Object.assign(defaultProfile(profile.transport || 'websocket-client'), profile || {});
        result.allowedGroupIds = Array.isArray(result.allowedGroupIds) ? result.allowedGroupIds.map(String) : [];
        result.allowedPrivateIds = Array.isArray(result.allowedPrivateIds) ? result.allowedPrivateIds.map(String) : [];
        result.allowedActions = Array.isArray(result.allowedActions) ? result.allowedActions.map(String) : [];
        return result;
      }

      function endpoint(profile) {
        return /-server$/.test(profile.transport)
          ? profile.host + ':' + profile.port
          : profile.url || '未配置 URL';
      }

      function transportKind(profile) {
        return /^websocket/.test(profile.transport) ? 'WebSocket' : 'HTTP';
      }

      function renderCard(profile,index) {
        return '<article class="config-card ' + (profile.enabled ? '' : 'disabled') + '">'
          + '<div class="card-head"><div class="card-title"><span class="badge">' + esc(labels[profile.transport] || profile.transport) + '</span><h3>' + esc(profile.name) + '</h3><code class="endpoint">' + esc(endpoint(profile)) + '</code></div>'
          + '<label class="switch" title="启用或停用"><input type="checkbox" data-action="toggle" data-index="' + index + '" ' + (profile.enabled ? 'checked' : '') + '><span class="slider"></span></label></div>'
          + '<div class="card-stats"><div class="stat"><strong>' + profile.allowedGroupIds.length + '</strong><span>允许群</span></div><div class="stat"><strong>' + (Array.isArray(profile.allowedPrivateIds) ? profile.allowedPrivateIds.length : 0) + '</strong><span>联系人</span></div><div class="stat"><strong>' + esc(transportKind(profile)) + '</strong><span>传输协议</span></div><div class="stat"><strong>' + (profile.accessToken ? '已设置' : '未设置') + '</strong><span>Token</span></div></div>'
          + '<div class="card-actions"><button class="button small" data-action="edit" data-index="' + index + '">编辑</button><button class="button small" data-action="duplicate" data-index="' + index + '">复制</button><button class="button small danger" data-action="delete" data-index="' + index + '">删除</button></div>'
          + '</article>';
      }

      function render() {
        document.getElementById('enabled').checked = !!state.enabled;
        document.getElementById('debug').checked = !!state.debug;
        document.getElementById('enabled').disabled = busy;
        document.getElementById('debug').disabled = busy;
        document.getElementById('reload').disabled = busy;
        document.getElementById('add').disabled = busy;
        document.getElementById('active-count').textContent = String(state.activeTransportCount || 0);
        document.getElementById('profile-count').textContent = state.profiles.length + ' 条配置';
        var cards = document.getElementById('cards');
        var html = state.profiles.map(renderCard).join('');
        html += '<button class="add-card" data-action="add"><span><span class="plus">＋</span><strong>新增网络配置</strong><br><small>创建独立的群消息过滤连接</small></span></button>';
        cards.innerHTML = html;
        bindCardEvents();
      }

      function bindCardEvents() {
        document.querySelectorAll('[data-action]').forEach(function (element) {
          element.addEventListener('click', async function () {
            var action = element.getAttribute('data-action');
            var index = Number(element.getAttribute('data-index'));
            if (action === 'add') return openModal(null,false);
            if (action === 'edit') return openModal(index,false);
            if (action === 'duplicate') return openModal(index,true);
            if (action === 'delete') return deleteProfile(index);
            if (action === 'toggle') return toggleProfile(index,element.checked);
          });
        });
      }

      function setFormValue(id,value) {
        var element = document.getElementById(id);
        if (element.type === 'checkbox') element.checked = !!value;
        else element.value = value == null ? '' : String(value);
      }

      function openModal(index,duplicate) {
        editingIndex = duplicate ? null : index;
        if (index == null) editingProfile = defaultProfile('websocket-client');
        else editingProfile = normalizeProfile(JSON.parse(JSON.stringify(state.profiles[index])));
        if (duplicate) {
          editingProfile.id = idFor(editingProfile.transport);
          editingProfile.name += '（副本）';
          editingProfile.enabled = true;
        }
        document.getElementById('modal-title').textContent = index == null ? '新增网络配置' : duplicate ? '复制网络配置' : '编辑网络配置';
        setFormValue('profile-name',editingProfile.name);
        setFormValue('profile-transport',editingProfile.transport);
        setFormValue('profile-url',editingProfile.url);
        setFormValue('profile-host',editingProfile.host);
        setFormValue('profile-port',editingProfile.port);
        setFormValue('profile-token',editingProfile.accessToken);
        setFormValue('profile-heartbeat',editingProfile.heartbeatIntervalMs);
        setFormValue('profile-reconnect',editingProfile.reconnectIntervalMs);
        setFormValue('profile-groups',editingProfile.allowedGroupIds.join('\n'));
        setFormValue('profile-private-contacts',editingProfile.allowedPrivateIds.join('\n'));
        setFormValue('profile-private',editingProfile.forwardPrivateMessages);
        setFormValue('profile-events',editingProfile.forwardNonGroupEvents);
        setFormValue('profile-meta',editingProfile.forwardMetaEvents);
        setFormValue('profile-strict',editingProfile.strictActionGuard);
        setFormValue('profile-actions',editingProfile.allowedActions.join('\n'));
        updateConnectionFields();
        modalInitialSnapshot = formSnapshot();
        document.getElementById('modal-backdrop').classList.remove('hidden');
        document.body.style.overflow = 'hidden';
        document.getElementById('profile-name').focus();
      }

      function updateConnectionFields() {
        var transport = document.getElementById('profile-transport').value;
        var isServer = /-server$/.test(transport);
        var isWs = /^websocket/.test(transport);
        document.getElementById('url-field').classList.toggle('hidden',isServer);
        document.getElementById('host-field').classList.toggle('hidden',!isServer);
        document.getElementById('port-field').classList.toggle('hidden',!isServer);
        document.getElementById('heartbeat-field').classList.toggle('hidden',!isWs);
        document.getElementById('reconnect-field').classList.toggle('hidden',transport !== 'websocket-client');
        document.getElementById('url-hint').textContent = isWs ? '仅支持 ws:// 或 wss://' : '仅支持 http:// 或 https://';
      }

      function handleTransportChange() {
        var transport = document.getElementById('profile-transport').value;
        var urlInput = document.getElementById('profile-url');
        var portInput = document.getElementById('profile-port');
        var knownDefaults = ['ws://127.0.0.1:6199/ws','http://127.0.0.1:8080/onebot/events'];
        if (transport === 'websocket-client' && (!urlInput.value || knownDefaults.indexOf(urlInput.value) >= 0)) urlInput.value = 'ws://127.0.0.1:6199/ws';
        if (transport === 'http-client' && (!urlInput.value || knownDefaults.indexOf(urlInput.value) >= 0)) urlInput.value = 'http://127.0.0.1:8080/onebot/events';
        if (transport === 'websocket-server' && (!portInput.value || portInput.value === '3002')) portInput.value = '3001';
        if (transport === 'http-server' && (!portInput.value || portInput.value === '3001')) portInput.value = '3002';
        updateConnectionFields();
      }

      function formSnapshot() {
        return JSON.stringify(Array.from(document.getElementById('profile-form').elements).map(function (element) {
          return [element.name || element.id,element.type === 'checkbox' ? element.checked : element.value];
        }));
      }

      function requestCloseModal(force) {
        if (!force && formSnapshot() !== modalInitialSnapshot && !confirm('放弃弹窗中尚未保存的修改吗？')) return;
        document.getElementById('modal-backdrop').classList.add('hidden');
        document.body.style.overflow = '';
        editingIndex = null;
        editingProfile = null;
      }

      function collectModalProfile() {
        var transport = document.getElementById('profile-transport').value;
        var isWs = /^websocket/.test(transport);
        var isServer = /-server$/.test(transport);
        var name = document.getElementById('profile-name').value.trim();
        if (!name) throw new Error('请填写配置名称');
        var groups = splitList(document.getElementById('profile-groups').value);
        groups.forEach(function (groupId) { if (!/^\d+$/.test(groupId)) throw new Error('无效群号：' + groupId); });
        var contacts = splitList(document.getElementById('profile-private-contacts').value);
        contacts.forEach(function (contactId) { if (!/^\d+$/.test(contactId)) throw new Error('无效联系人 QQ 号：' + contactId); });
        var profile = Object.assign(defaultProfile(transport),editingProfile || {},{
          name: name,
          transport: transport,
          host: document.getElementById('profile-host').value.trim() || '127.0.0.1',
          port: Number(document.getElementById('profile-port').value || (isWs ? 3001 : 3002)),
          path: '/',
          url: document.getElementById('profile-url').value.trim(),
          accessToken: document.getElementById('profile-token').value,
          allowedGroupIds: groups,
          allowedPrivateIds: contacts,
          forwardPrivateMessages: document.getElementById('profile-private').checked,
          forwardNonGroupEvents: document.getElementById('profile-events').checked,
          forwardMetaEvents: document.getElementById('profile-meta').checked,
          strictActionGuard: document.getElementById('profile-strict').checked,
          allowedActions: splitList(document.getElementById('profile-actions').value),
          heartbeatIntervalMs: isWs ? Number(document.getElementById('profile-heartbeat').value || 0) : 0,
          reconnectIntervalMs: transport === 'websocket-client' ? Number(document.getElementById('profile-reconnect').value || 5000) : 5000,
          requestTimeoutMs: 10000,
          maxPendingEvents: 1000,
          headers: {}
        });
        if (isServer && (!Number.isInteger(profile.port) || profile.port < 1 || profile.port > 65535)) throw new Error('监听端口必须在 1 到 65535 之间');
        if (!isServer && !profile.url) throw new Error('请填写目标 URL');
        return profile;
      }

      function showToast(message,error) {
        var toast = document.getElementById('toast');
        toast.textContent = message;
        toast.className = 'toast show' + (error ? ' error' : '');
        clearTimeout(showToast.timer);
        showToast.timer = setTimeout(function () { toast.className = 'toast'; },3200);
      }

      async function api(path,options) {
        var requestOptions = Object.assign({ credentials: 'include' },options || {});
        requestOptions.headers = Object.assign({},requestOptions.headers || {});
        var storedToken = localStorage.getItem('token');
        if (storedToken) {
          var token = storedToken;
          try { token = JSON.parse(storedToken); } catch (_) {}
          if (token) requestOptions.headers.Authorization = 'Bearer ' + token;
        }
        var response = await fetch(apiBase + path,requestOptions);
        var data;
        try { data = await response.json(); } catch (_) { data = { success:false,message:'服务器返回了无法解析的响应' }; }
        if (!response.ok || !data.success) throw new Error(data.message || ('请求失败：HTTP ' + response.status));
        return data.data;
      }

      function applyServerData(data) {
        state.enabled = !!data.enabled;
        state.debug = !!data.debug;
        state.activeTransportCount = Number(data.activeTransportCount || 0);
        state.profiles = (data.profiles || []).map(normalizeProfile);
      }

      async function persist(next,message) {
        if (busy) return false;
        busy = true;
        render();
        document.getElementById('modal-save').disabled = true;
        try {
          var data = await api('/config',{
            method:'POST',
            headers:{ 'content-type':'application/json' },
            body:JSON.stringify({ enabled:next.enabled,debug:next.debug,profiles:next.profiles })
          });
          applyServerData(data);
          render();
          showToast(message || '已保存');
          return true;
        } catch (error) {
          showToast(error.message,true);
          render();
          return false;
        } finally {
          busy = false;
          render();
          document.getElementById('modal-save').disabled = false;
        }
      }

      async function saveModal() {
        var profile = collectModalProfile();
        var profiles = state.profiles.slice();
        if (editingIndex == null) profiles.push(profile);
        else profiles[editingIndex] = profile;
        var unsafe = /-server$/.test(profile.transport) && profile.host !== '127.0.0.1' && profile.host !== 'localhost' && !profile.accessToken;
        if (unsafe && !confirm('该服务端监听非本机地址且未配置 Token，确定保存吗？')) return;
        if (await persist({ enabled:state.enabled,debug:state.debug,profiles:profiles },'网络配置已保存')) requestCloseModal(true);
      }

      async function toggleProfile(index,enabled) {
        var profiles = state.profiles.map(function (profile,i) { return i === index ? Object.assign({},profile,{ enabled:enabled }) : profile; });
        await persist({ enabled:state.enabled,debug:state.debug,profiles:profiles },enabled ? '配置已启用' : '配置已停用');
      }

      async function deleteProfile(index) {
        if (!confirm('确定删除配置“' + state.profiles[index].name + '”吗？')) return;
        var profiles = state.profiles.filter(function (_profile,i) { return i !== index; });
        await persist({ enabled:state.enabled,debug:state.debug,profiles:profiles },'配置已删除');
      }

      async function saveGlobal(key,value) {
        var next = { enabled:state.enabled,debug:state.debug,profiles:state.profiles };
        next[key] = value;
        await persist(next,key === 'enabled' ? '网关状态已保存' : '日志设置已保存');
      }

      async function load() {
        document.getElementById('cards').innerHTML = '<div class="panel loading">正在读取插件配置…</div>';
        try {
          applyServerData(await api('/config'));
          render();
        } catch (error) {
          document.getElementById('cards').innerHTML = '<div class="panel empty"><strong>配置读取失败</strong>' + esc(error.message) + '</div>';
          showToast(error.message,true);
        }
      }

      document.getElementById('add').addEventListener('click',function () { openModal(null,false); });
      document.getElementById('reload').addEventListener('click',load);
      document.getElementById('enabled').addEventListener('change',function (event) { saveGlobal('enabled',event.target.checked); });
      document.getElementById('debug').addEventListener('change',function (event) { saveGlobal('debug',event.target.checked); });
      document.getElementById('profile-transport').addEventListener('change',handleTransportChange);
      document.getElementById('profile-form').addEventListener('submit',function (event) { event.preventDefault(); saveModal().catch(function (error) { showToast(error.message,true); }); });
      document.getElementById('modal-close').addEventListener('click',function () { requestCloseModal(false); });
      document.getElementById('modal-cancel').addEventListener('click',function () { requestCloseModal(false); });
      document.getElementById('modal-backdrop').addEventListener('click',function (event) { if (event.target === event.currentTarget) requestCloseModal(false); });
      document.addEventListener('keydown',function (event) { if (event.key === 'Escape' && !document.getElementById('modal-backdrop').classList.contains('hidden')) requestCloseModal(false); });
      load();
    })();
  </script>
</body>
</html>`;
}
