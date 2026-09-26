import type { NetworkProfile, PluginConfig, TransportType } from './types.js';

const DEFAULT_PROFILES: NetworkProfile[] = [];

export const DEFAULT_CONFIG: PluginConfig = {
  enabled: true,
  debug: false,
  profilesJson: JSON.stringify(DEFAULT_PROFILES, null, 2),
};

const TRANSPORTS = new Set<TransportType>([
  'websocket-server',
  'websocket-client',
  'http-server',
  'http-client',
]);

function asObject(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function asString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function asBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function asInteger(value: unknown, fallback: number, min: number, max: number): number {
  const number = typeof value === 'number' ? Math.trunc(value) : Number(value);
  return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback;
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map(String).map((item) => item.trim()).filter(Boolean))];
}

function normalizeHeaders(value: unknown): Record<string, string> {
  return Object.fromEntries(
    Object.entries(asObject(value))
      .filter(([, headerValue]) => ['string', 'number', 'boolean'].includes(typeof headerValue))
      .map(([key, headerValue]) => [key, String(headerValue)]),
  );
}

export function normalizeConfig(value: unknown): PluginConfig {
  const config = asObject(value);
  return {
    enabled: asBoolean(config.enabled, DEFAULT_CONFIG.enabled),
    debug: asBoolean(config.debug, DEFAULT_CONFIG.debug),
    profilesJson: asString(config.profilesJson, DEFAULT_CONFIG.profilesJson),
  };
}

export function parseProfiles(profilesJson: string): NetworkProfile[] {
  const parsed: unknown = JSON.parse(profilesJson);
  if (!Array.isArray(parsed)) {
    throw new Error('profilesJson 必须是 JSON 数组');
  }

  const ids = new Set<string>();
  return parsed.map((rawProfile, index) => {
    const raw = asObject(rawProfile);
    const transportValue = asString(raw.transport) as TransportType;
    if (!TRANSPORTS.has(transportValue)) {
      throw new Error(`第 ${index + 1} 个配置的 transport 无效: ${transportValue || '(空)'}`);
    }

    const id = asString(raw.id, `profile-${index + 1}`).trim() || `profile-${index + 1}`;
    if (ids.has(id)) throw new Error('网络配置内部标识重复，请删除重复项后重新创建配置');
    ids.add(id);

    return {
      id,
      name: asString(raw.name, id).trim() || id,
      enabled: asBoolean(raw.enabled, true),
      transport: transportValue,
      host: asString(raw.host, '127.0.0.1'),
      port: asInteger(raw.port, 3001, 1, 65535),
      // 服务端统一使用根路径，连接配置只保留 Host 和 Port。
      path: '/',
      url: asString(raw.url),
      accessToken: asString(raw.accessToken),
      allowedGroupIds: asStringArray(raw.allowedGroupIds),
      allowedPrivateIds: asStringArray(raw.allowedPrivateIds),
      forwardPrivateMessages: asBoolean(raw.forwardPrivateMessages, false),
      forwardNonGroupEvents: asBoolean(raw.forwardNonGroupEvents, false),
      forwardMetaEvents: asBoolean(raw.forwardMetaEvents, true),
      strictActionGuard: asBoolean(raw.strictActionGuard, true),
      allowedActions: asStringArray(raw.allowedActions),
      heartbeatIntervalMs: asInteger(raw.heartbeatIntervalMs, 15000, 0, 3_600_000),
      reconnectIntervalMs: asInteger(raw.reconnectIntervalMs, 5000, 500, 3_600_000),
      requestTimeoutMs: asInteger(raw.requestTimeoutMs, 10000, 100, 3_600_000),
      maxPendingEvents: asInteger(raw.maxPendingEvents, 1000, 1, 100_000),
      headers: normalizeHeaders(raw.headers),
    };
  });
}

export function validateProfiles(value: unknown): NetworkProfile[] {
  const profiles = parseProfiles(JSON.stringify(value));
  for (const profile of profiles) {
    if (profile.transport === 'websocket-client' || profile.transport === 'http-client') {
      if (!profile.url.trim()) throw new Error(`配置“${profile.name}”缺少目标 URL`);
      let url: URL;
      try {
        url = new URL(profile.url);
      } catch {
        throw new Error(`配置“${profile.name}”的目标 URL 无效`);
      }
      const allowedProtocols = profile.transport === 'websocket-client'
        ? new Set(['ws:', 'wss:'])
        : new Set(['http:', 'https:']);
      if (!allowedProtocols.has(url.protocol)) {
        throw new Error(`配置“${profile.name}”的 URL 协议与传输类型不匹配`);
      }
    }
    // 服务端校验联系人 QQ 号，浏览器校验不可信（AGENTS.md 安全约定）。
    for (const id of profile.allowedPrivateIds) {
      if (!/^\d+$/.test(id)) {
        throw new Error(`配置“${profile.name}”的联系人 QQ 号无效: ${id}`);
      }
    }
  }
  return profiles;
}
