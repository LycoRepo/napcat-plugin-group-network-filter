/**
 * NapCat 插件 API 的最小类型桥接。
 *
 * napcat-types 0.0.17 的 npm 发布包会从根入口递归加载 NapCat Core，且其中一份
 * UploadForwardMsgV2 声明不完整。插件只需要以下稳定接口，因此在本项目中维护最小结构类型，
 * 避免将 NapCat 内部实现或损坏声明带入类型检查和构建产物。
 */

export interface PluginConfigItem {
  key: string;
  type: 'string' | 'number' | 'boolean' | 'select' | 'multi-select' | 'html' | 'text';
  label: string;
  description?: string;
  default?: unknown;
  options?: Array<{ label: string; value: string | number }>;
  placeholder?: string;
  reactive?: boolean;
  hidden?: boolean;
}

export type PluginConfigSchema = PluginConfigItem[];

export interface PluginLogger {
  log(...args: unknown[]): void;
  debug(...args: unknown[]): void;
  info(...args: unknown[]): void;
  warn(...args: unknown[]): void;
  error(...args: unknown[]): void;
}

export interface NapCatActionMap {
  call(
    actionName: string,
    params: unknown,
    adapterName: string,
    config: unknown,
  ): Promise<unknown>;
}

export interface PluginHttpRequest {
  path: string;
  method: string;
  query: Record<string, string | string[] | undefined>;
  body: unknown;
  headers: Record<string, string | string[] | undefined>;
  params: Record<string, string>;
  raw: unknown;
}

export interface PluginHttpResponse {
  status(code: number): PluginHttpResponse;
  json(data: unknown): void;
  send(data: string | Buffer): void;
  setHeader(name: string, value: string): PluginHttpResponse;
  sendFile(filePath: string): void;
  redirect(url: string): void;
  raw: unknown;
}

export type PluginNextFunction = (error?: unknown) => void;
export type PluginRequestHandler = (
  request: PluginHttpRequest,
  response: PluginHttpResponse,
  next: PluginNextFunction,
) => void | Promise<void>;

export interface PluginPageDefinition {
  path: string;
  title: string;
  icon?: string;
  htmlFile: string;
  description?: string;
}

export interface PluginRouterRegistry {
  get(path: string, handler: PluginRequestHandler): void;
  post(path: string, handler: PluginRequestHandler): void;
  page(definition: PluginPageDefinition): void;
}

export interface NapCatPluginContext {
  actions: NapCatActionMap;
  pluginName: string;
  pluginPath: string;
  configPath: string;
  dataPath: string;
  adapterName: string;
  pluginManager: { config: unknown };
  logger: PluginLogger;
  router: PluginRouterRegistry;
}

export interface PluginModule<TEvent = Record<string, unknown>, TConfig = unknown> {
  plugin_init: (context: NapCatPluginContext) => void | Promise<void>;
  plugin_onmessage?: (context: NapCatPluginContext, event: Record<string, unknown>) => void | Promise<void>;
  plugin_onevent?: (context: NapCatPluginContext, event: TEvent) => void | Promise<void>;
  plugin_cleanup?: (context: NapCatPluginContext) => void | Promise<void>;
  plugin_config_schema?: PluginConfigSchema;
  plugin_config_ui?: PluginConfigSchema;
  plugin_get_config?: (context: NapCatPluginContext) => TConfig | Promise<TConfig>;
  plugin_set_config?: (context: NapCatPluginContext, config: TConfig) => void | Promise<void>;
}
