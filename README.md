# NapCat 群网络过滤网关

这是一个 NapCat 插件，为每个 OneBot 11 网络配置设置独立的群白名单。只有白名单群的事件会发给对应服务；严格模式下，对端也不能操作非白名单群。

## 适用场景

例如 NapCat 同时连接 AstrBot 和其他服务，但 AstrBot 只能接触群 `123456789`：

```text
NapCat
├─ AstrBot 配置：只允许群 123456789
└─ 其他服务配置：可使用另一组群白名单
```

插件提供四种传输类型：

| `transport` | NapCat 一侧角色 | 功能 |
| --- | --- | --- |
| `websocket-server` | WebSocket 服务端 | 对端主动连接；同一连接双向传输事件和 Action |
| `websocket-client` | WebSocket 客户端 | 插件主动连接对端；同一连接双向传输事件和 Action |
| `http-server` | HTTP Action 服务端 | 对端通过 HTTP 调用 OneBot Action |
| `http-client` | HTTP 事件客户端 | 插件通过 HTTP POST 向对端推送事件 |

OneBot 11 的 HTTP 通信天然将 Action API 与事件上报拆开。需要完整的双向 HTTP 时，同时创建一个 `http-server` 和一个 `http-client` 配置，并给它们设置相同的群白名单。

## 安装

1. 安装依赖并执行 `npm run build`。
2. 构建完成后，`dist` 目录中只包含部署需要的 `index.mjs` 和 `package.json`。
3. 在 NapCat 的 `plugins` 目录中新建插件子目录，将这两个文件复制进去。
4. 在 NapCat WebUI 中启用插件。
5. 打开侧边栏中的“群网络过滤”页面，通过表单新增和编辑网络配置。
6. 点击“保存并应用”，插件会立即重载相关连接。
7. 禁用 NapCat 中原来直连目标服务的网络配置，防止未过滤事件绕过本插件。

部署后的目录结构：

```text
NapCat/plugins/
└── napcat-plugin-group-network-filter/
    ├── index.mjs
    └── package.json
```

部署版 `package.json` 的入口固定为 `index.mjs`，不需要复制源码、`node_modules` 或根目录的开发版 `package.json`。
WebUI 页面代码已嵌入 `index.mjs`，插件首次加载时会在插件目录自动生成页面文件，因此安装时仍只需要上述两个文件。

插件不再注册 NapCat 默认配置表单。网关启停、调试日志和所有网络配置均只通过侧边栏中的“群网络过滤”专用页面管理。NapCat 插件管理器自身的启用开关仍用于控制插件是否加载。

> 必须禁用原来的直连配置。本插件创建的是独立过滤网关，不能阻止另一个 NapCat 内置网络配置继续发送事件。

## WebUI 配置

插件提供独立的可视化配置页面，不再要求用户编辑 `profilesJson`：

- 主页面以卡片形式展示配置名称、协议、连接地址、启用状态、群数量和 Token 状态。
- 点击“新增配置”或卡片上的“编辑”按钮，通过弹窗配置网络连接。
- 支持在卡片上复制、删除、启用或停用网络配置。
- 配置 ID 由插件内部自动生成和维护，不会显示在 WebUI 中。
- 选择正向/反向 WebSocket 或正向/反向 HTTP 后，弹窗会自动显示对应的连接字段。
- 每行填写一个允许的群号，也支持逗号或空格分隔。
- 配置 Access Token、私聊与事件转发策略、严格 Action 限制。
- WebSocket 配置可设置心跳；仅 WebSocket 客户端可设置重连间隔。
- 弹窗点击“保存”后由服务端再次验证配置，并立即重启插件网络连接。
- 插件开关、调试日志和卡片启用开关均为即时保存，不再使用“保存并应用”。

旧版本的 `profilesJson` 配置会自动读取并展示在 WebUI 中，无需手工迁移。

## AstrBot：反向 WebSocket 配置参考

NapCat 主动连接 AstrBot 时使用 `websocket-client`：

插件会自动发送 OneBot 11 反向 WebSocket 所需的 `X-Self-ID`、`X-Client-Role: Universal` 和 `User-Agent: OneBot/11` 请求头；配置 Token 后还会发送 Bearer Authorization 请求头。

WebSocket 使用纯 JavaScript 帧编码和 UTF-8 校验，不依赖 `bufferutil`、`utf-8-validate` 等平台相关原生模块，因此同一构建产物可以在 Windows 和 Linux/Docker 中运行。

```json
[
  {
    "id": "astrbot-ws-client",
    "name": "AstrBot 反向 WebSocket",
    "enabled": true,
    "transport": "websocket-client",
    "url": "ws://127.0.0.1:6199/ws",
    "accessToken": "",
    "allowedGroupIds": ["123456789"],
    "forwardPrivateMessages": false,
    "forwardNonGroupEvents": false,
    "forwardMetaEvents": true,
    "strictActionGuard": true,
    "allowedActions": [],
    "heartbeatIntervalMs": 15000,
    "reconnectIntervalMs": 5000
  }
]
```

## WebSocket 服务端配置参考

服务主动连接本插件：

```json
{
  "id": "local-ws-server",
  "name": "本地 WS 服务端",
  "enabled": true,
  "transport": "websocket-server",
  "host": "127.0.0.1",
  "port": 3001,
  "accessToken": "change-me",
  "allowedGroupIds": ["123456789", "987654321"],
  "forwardPrivateMessages": false,
  "forwardNonGroupEvents": false,
  "forwardMetaEvents": true,
  "strictActionGuard": true,
  "heartbeatIntervalMs": 15000
}
```

连接地址：`ws://127.0.0.1:3001/`。Token 可通过请求头 `Authorization: Bearer change-me` 或查询参数 `access_token` 提交。

## 双向 HTTP 配置参考

```json
[
  {
    "id": "service-http-actions",
    "name": "服务 HTTP Action 入口",
    "enabled": true,
    "transport": "http-server",
    "host": "127.0.0.1",
    "port": 3002,
    "accessToken": "change-me",
    "allowedGroupIds": ["123456789"],
    "strictActionGuard": true
  },
  {
    "id": "service-http-events",
    "name": "服务 HTTP 事件上报",
    "enabled": true,
    "transport": "http-client",
    "url": "http://127.0.0.1:8080/onebot/events",
    "accessToken": "change-me",
    "allowedGroupIds": ["123456789"],
    "forwardPrivateMessages": false,
    "forwardNonGroupEvents": false,
    "forwardMetaEvents": true,
    "strictActionGuard": true
  }
]
```

HTTP Action 支持以下形式：

```http
POST /onebot/send_group_msg
Authorization: Bearer change-me
Content-Type: application/json

{"group_id":"123456789","message":"测试"}
```

也支持统一 Action 封装：

```http
POST /onebot
Content-Type: application/json

{"action":"send_group_msg","params":{"group_id":"123456789","message":"测试"},"echo":"abc"}
```

HTTP 事件端点可以返回 OneBot 快速操作对象，或返回以下通用 Action 对象：

```json
{"action":"send_group_msg","params":{"group_id":"123456789","message":"收到"}}
```

## 配置字段

| 字段 | 默认值 | 说明 |
| --- | --- | --- |
| `id` | 自动生成 | 配置唯一 ID，不能重复 |
| `name` | 等于 ID | 日志中显示的名称 |
| `enabled` | `true` | 是否启用该配置 |
| `transport` | 无 | 四种传输类型之一 |
| `allowedGroupIds` | `[]` | 允许的群号；空数组表示不允许任何群 |
| `accessToken` | 空 | HTTP/WS Bearer Token；生产环境建议填写 |
| `strictActionGuard` | `true` | 限制对端只能操作白名单群 |
| `allowedActions` | `[]` | 严格模式下额外放行的 Action 名称 |
| `forwardPrivateMessages` | `false` | 是否转发私聊消息 |
| `forwardNonGroupEvents` | `false` | 是否转发不含 `group_id` 的非消息事件 |
| `forwardMetaEvents` | `true` | 是否转发 NapCat 元事件 |
| `heartbeatIntervalMs` | `15000` | 仅 WebSocket 使用；设为 `0` 关闭插件生成的心跳 |
| `reconnectIntervalMs` | `5000` | 仅 WebSocket 客户端使用的断线重连间隔 |

## 安全边界

严格模式默认采用“无法确定所属群则拒绝”的策略：

- 带 `group_id` 的 Action 只有目标群在白名单中才允许执行。
- `get_group_list` 可以执行，但返回值会过滤为白名单群。
- 登录状态、版本信息等必要的全局只读 Action 可以执行。
- 私聊、按 `message_id` 查询消息等无法可靠确定所属群的 Action 默认拒绝。
- 可通过 `allowedActions` 明确放行额外 Action，但这可能扩大对端可访问的数据范围。

插件只能控制经过自身的连接。若保留 NapCat 原生直连或另一个未过滤连接，对端仍可能从该连接收到其他群事件。

## 当前限制

- WebSocket 客户端离线期间不会缓存事件。
- HTTP 事件队列位于内存中，重启插件后不会保留。
- 不负责 TLS 终止；公网使用时建议放在受信任的 HTTPS/WSS 反向代理之后。
