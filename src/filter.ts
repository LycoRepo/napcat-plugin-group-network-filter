import type { NetworkProfile, OneBotEvent } from './types.js';

const SAFE_GLOBAL_ACTIONS = new Set([
  'get_login_info',
  'get_status',
  'get_version_info',
  'can_send_image',
  'can_send_record',
  'get_group_list',
]);

export function getGroupId(value: unknown): string | undefined {
  if (typeof value === 'string' || typeof value === 'number') return String(value);
  return undefined;
}

// NapCat 为同一处理器注册 name / name_async / name_rate_limited 三个别名。
// 权限判定一律按基名比较：只剥一层后缀，大小写敏感；不写回配置，实际调用仍用原始 Action 名。
export function normalizeActionName(raw: string): string {
  return raw.replace(/_(async|rate_limited)$/, '');
}

export function shouldForwardEvent(profile: NetworkProfile, event: OneBotEvent): boolean {
  const postType = String(event.post_type ?? '');
  const groupId = getGroupId(event.group_id);

  if (groupId !== undefined) return profile.allowedGroupIds.includes(groupId);
  if (postType === 'meta_event') return profile.forwardMetaEvents;
  if (postType === 'message' || postType === 'message_sent') {
    return event.message_type === 'private' && profile.forwardPrivateMessages;
  }
  return profile.forwardNonGroupEvents;
}

export function isActionAllowed(
  profile: NetworkProfile,
  action: string,
  params: Record<string, unknown>,
): { allowed: boolean; reason?: string } {
  if (!profile.strictActionGuard) return { allowed: true };
  // 请求名与 allowedActions 每一项都先归一化再比较，杜绝 _async / _rate_limited 后缀绕过。
  const normalizedAction = normalizeActionName(action);
  if (profile.allowedActions.some((name) => normalizeActionName(name) === normalizedAction)) return { allowed: true };

  const groupId = getGroupId(params.group_id);
  if (groupId !== undefined) {
    return profile.allowedGroupIds.includes(groupId)
      ? { allowed: true }
      : { allowed: false, reason: `群 ${groupId} 不在配置 ${profile.name} 的白名单中` };
  }

  if (normalizedAction === 'send_msg' && params.message_type === 'group') {
    return { allowed: false, reason: '群消息 Action 缺少 group_id' };
  }

  if (SAFE_GLOBAL_ACTIONS.has(normalizedAction)) return { allowed: true };
  return { allowed: false, reason: `严格模式禁止无法关联到白名单群的 Action: ${action}` };
}

function filterValue(value: unknown, allowedGroups: Set<string>): unknown {
  if (Array.isArray(value)) {
    return value
      .map((item) => filterValue(item, allowedGroups))
      .filter((item) => item !== undefined);
  }

  if (value === null || typeof value !== 'object') return value;
  const object = value as Record<string, unknown>;
  const groupId = getGroupId(object.group_id);
  if (groupId !== undefined && !allowedGroups.has(groupId)) return undefined;

  return Object.fromEntries(
    Object.entries(object)
      .map(([key, item]) => [key, filterValue(item, allowedGroups)] as const)
      .filter(([, item]) => item !== undefined),
  );
}

export function filterActionResult(profile: NetworkProfile, data: unknown): unknown {
  if (!profile.strictActionGuard) return data;
  return filterValue(data, new Set(profile.allowedGroupIds)) ?? null;
}
