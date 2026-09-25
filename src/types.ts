export type TransportType =
  | 'websocket-server'
  | 'websocket-client'
  | 'http-server'
  | 'http-client';

export interface PluginConfig {
  enabled: boolean;
  debug: boolean;
  profilesJson: string;
}

export interface NetworkProfile {
  id: string;
  name: string;
  enabled: boolean;
  transport: TransportType;
  host: string;
  port: number;
  path: string;
  url: string;
  accessToken: string;
  allowedGroupIds: string[];
  allowedPrivateIds: string[];
  forwardPrivateMessages: boolean;
  forwardNonGroupEvents: boolean;
  forwardMetaEvents: boolean;
  strictActionGuard: boolean;
  allowedActions: string[];
  heartbeatIntervalMs: number;
  reconnectIntervalMs: number;
  requestTimeoutMs: number;
  maxPendingEvents: number;
  headers: Record<string, string>;
}

export type OneBotEvent = Record<string, unknown>;

export interface OneBotActionRequest {
  action: string;
  params?: Record<string, unknown>;
  echo?: unknown;
}

export interface OneBotActionResponse {
  status: 'ok' | 'failed';
  retcode: number;
  data: unknown;
  message?: string;
  wording?: string;
  echo?: unknown;
}

export interface LoggerLike {
  debug(message: string): void;
  info(message: string): void;
  warn(message: string): void;
  error(message: string): void;
}

export interface TransportDependencies {
  logger: LoggerLike;
  debug: boolean;
  selfId: string;
  executeAction(profile: NetworkProfile, payload: unknown): Promise<OneBotActionResponse>;
  executeQuickOperation(profile: NetworkProfile, event: OneBotEvent, payload: unknown): Promise<void>;
}

export interface NetworkTransport {
  readonly profile: NetworkProfile;
  start(): Promise<void>;
  stop(): Promise<void>;
  forwardEvent(event: OneBotEvent): void;
}
