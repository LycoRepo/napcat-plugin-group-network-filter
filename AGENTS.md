# NapCat 群网络过滤网关

> 为 NapCat 提供按群白名单隔离的 OneBot 11 WebSocket 与 HTTP 网络连接。

## 项目概述

本项目是独立 NapCat 插件。每个插件网络配置拥有自己的群白名单，只向目标服务发送允许群的事件，并可在严格模式下阻止目标服务操作其他群。

插件不拦截 NapCat 原生网络配置。部署时必须关闭目标服务原有的直连配置，改为使用本插件创建的过滤连接。

## 技术栈

### 核心技术

- 语言：TypeScript 5
- 运行时：Node.js 18 或更高版本
- 插件接口：项目内最小类型桥接，与 NapCat 当前插件 API 保持结构兼容
- WebSocket：`ws`
- 协议：OneBot 11

### 开发工具

- 构建工具：Vite
- 类型检查：TypeScript
- 包管理：npm、pnpm 或兼容工具
- 版本控制：Git

## 目录结构

```text
项目根目录/
├── src/
│   ├── index.ts       # NapCat 插件入口与生命周期
│   ├── state.ts       # 配置文件读写
│   ├── config.ts      # 配置解析与规范化
│   ├── filter.ts      # 事件白名单与 Action 权限过滤
│   ├── runtime.ts     # 网关生命周期和 OneBot Action 执行
│   ├── transports.ts  # WebSocket/HTTP 四类传输实现
│   ├── webui.ts       # 嵌入式配置页面和鉴权配置 API
│   └── types.ts       # 公共类型
├── README.md          # 安装、配置与安全说明
├── dist/              # 构建生成的双文件部署目录
├── package.json
├── tsconfig.json
└── vite.config.ts
```

## 环境要求

- Node.js：18 或更高版本
- NapCat：支持现代插件接口的版本
- Python：不使用
- Java：不使用

## 开发指南

### 代码规范

- TypeScript 变量和函数使用 `camelCase`，类型和类使用 `PascalCase`。
- 关键协议逻辑和安全边界使用中文注释。
- 新增传输类型时实现 `NetworkTransport` 接口，并在 `createTransport` 中注册。
- 不得绕过 `shouldForwardEvent` 或 `isActionAllowed` 直接转发事件、执行对端 Action。
- 所有外部输入都视为不可信数据，必须验证 JSON、Token、Action 和群号。
- WebUI 保存数据必须经过服务端 `validateProfiles` 校验，不能只依赖浏览器校验。
- 配置 API 必须使用 NapCat 鉴权路由，不得改为无认证路由。
- WebUI 使用配置卡片展示摘要，通过弹窗新增和编辑；配置 ID 只在内部维护，不得展示给用户。
- 弹窗“保存”、卡片开关、删除和全局开关均应立即调用配置 API，不保留额外的全局保存按钮。
- 不注册 NapCat 默认配置 Schema 或默认配置读写钩子，业务配置只允许通过专用 WebUI API 管理。

### 安全约定

- `strictActionGuard` 的默认值必须保持为 `true`。
- `allowedGroupIds` 为空时表示拒绝全部群，而不是允许全部群。
- 无法确定目标群的敏感 Action 默认拒绝。
- 不在源码或示例中提交真实 Token、群号或服务密码。
- 监听公网地址时必须明确提醒配置 Token，并建议使用 TLS 反向代理。

### 文档同步

修改以下内容时必须同步更新 `README.md`：

- 配置字段或默认值
- 传输协议行为
- Action 权限边界
- 安装或部署步骤
- 已知限制

## 验证流程

根据全局规则，不主动执行安装、构建、类型检查或运行命令。获得用户确认后依次执行：

```powershell
npm install
npm run typecheck
npm run build
```

构建完成后，`dist` 必须只包含 `index.mjs` 和入口指向该文件的精简 `package.json`。
WebUI HTML 嵌入 `index.mjs`，插件加载时在插件目录生成页面文件，不作为第三个部署文件发布。

手工联调至少覆盖：

1. 白名单群消息能够到达目标服务。
2. 非白名单群消息不会到达目标服务。
3. 白名单群 Action 可以执行。
4. 非白名单群 Action 返回拒绝响应。
5. `get_group_list` 只返回白名单群。
6. WS 断线后可以重连。
7. HTTP Token 错误时返回未授权。
