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
  if (profile.allowedActions.includes(action)) return { allowed: true };

  const groupId = getGroupId(params.group_id);
  if (groupId !== undefined) {
    return profile.allowedGroupIds.includes(groupId)
      ? { allowed: true }
      : { allowed: false, reason: `群 ${groupId} 不在配置 ${profile.name} 的白名单中` };
  }

  if (action === 'send_msg' && params.message_type === 'group') {
    return { allowed: false, reason: '群消息 Action 缺少 group_id' };
  }

  if (SAFE_GLOBAL_ACTIONS.has(action)) return { allowed: true };
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
