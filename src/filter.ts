import type { NetworkProfile, OneBotEvent } from './types.js';

const SAFE_GLOBAL_ACTIONS = new Set([
  'get_login_info',
  'get_status',
  'get_version_info',
  'can_send_image',
  'can_send_record',
  'get_group_list',
]);

// 私聊目标预检集合（14 项）：目标只能是 user_id 的敏感 Action，必须先确认私聊属主再看授权。
// 不变量：PRIVATE_TARGET_PRECHECK 与 SAFE_GLOBAL_ACTIONS 不相交（14 ∩ 6 = ∅）。
const PRIVATE_TARGET_PRECHECK = new Set([
  'send_private_msg',
  'send_private_forward_msg',
  'mark_private_msg_as_read',
  'nc_get_user_status',
  'send_msg',
  'send_forward_msg',
  'set_input_status',
  'send_like',
  'friend_poke',
  'get_friend_msg_history',
  'upload_private_file',
  'forward_friend_single_msg',
  'get_profile_like',
  'set_friend_remark',
]);

// 私聊自动放行集（6 项 A 类，均为低风险出站/状态行为）：
// 只有 allowedPrivateIds 非空且预检确认目标命中名单时才免 allowedActions；空名单一律不自动放行。
const PRIVATE_AUTO_ALLOW_ACTIONS = new Set([
  'send_private_msg',
  'send_private_forward_msg',
  'mark_private_msg_as_read',
  'nc_get_user_status',
  'send_msg',
  'send_forward_msg',
]);

export function getGroupId(value: unknown): string | undefined {
  if (typeof value === 'string' || typeof value === 'number') return String(value);
  return undefined;
}

export function getUserId(value: unknown): string | undefined {
  if (typeof value === 'string' || typeof value === 'number') return String(value);
  return undefined;
}

// NapCat 为同一处理器注册 name / name_async / name_rate_limited 三个别名。
// 权限判定一律按基名比较：只剥一层后缀，大小写敏感；不写回配置，实际调用仍用原始 Action 名。
export function normalizeActionName(raw: string): string {
  return raw.replace(/_(async|rate_limited)$/, '');
}

// 私聊入站判定：未开启转发 → 拒绝；名单为空 → 旧兼容放行全部私聊；名单非空 → 仅放行命中联系人。
function privateDecision(profile: NetworkProfile, userId: string | undefined): 'allow' | 'legacy-all' | 'deny' {
  if (!profile.forwardPrivateMessages) return 'deny';
  if (profile.allowedPrivateIds.length === 0) return 'legacy-all';
  return userId !== undefined && profile.allowedPrivateIds.includes(userId) ? 'allow' : 'deny';
}

export function shouldForwardEvent(profile: NetworkProfile, event: OneBotEvent): boolean {
  const postType = String(event.post_type ?? '');
  const groupId = getGroupId(event.group_id);

  if (groupId !== undefined) return profile.allowedGroupIds.includes(groupId);
  if (postType === 'meta_event') return profile.forwardMetaEvents;
  if (postType === 'message_sent') {
    // NapCat 证据（packages/napcat-onebot）：私聊 message_sent 的 user_id 是机器人自身
    // （senderUin === selfInfo.uin 时 post_type 才为 message_sent），对端联系人写入 target_id
    // （obMsg.target_id = peerUin）。必须按 target_id 判定对端，否则名单非空时机器人发往
    // 已允许联系人的消息被误拒（回归）。缺少 target_id 无法确定对端，与 group_id 熔断原则
    // 一致 fail-closed 拒绝；群聊 message_sent 带 group_id，已在上方群名单分支处理。
    const targetId = getUserId(event.target_id);
    if (targetId === undefined) return false;
    return privateDecision(profile, targetId) !== 'deny';
  }
  if (postType === 'message') {
    // 收到的私聊消息：user_id 是对端发送者，按其判定。
    return privateDecision(profile, getUserId(event.user_id)) !== 'deny';
  }
  return profile.forwardNonGroupEvents;
}

type PrivateTargetCheck =
  | { deny: true; reason: string }
  | { deny: false; inPrecheck: true; userId: string }
  | { deny: false; inPrecheck: false };

// 私聊目标预检（《最小变更方案 v5》§4.3）：只拒绝、不放行，且先于显式 allowedActions 判定。
function evaluatePrivateTarget(
  profile: NetworkProfile,
  action: string,
  params: Record<string, unknown>,
): PrivateTargetCheck {
  // send_msg / send_forward_msg 仅私聊形态进入预检；群形态继续走既有群路径，群聊行为不变。
  const conditionalEntry = action === 'send_msg' || action === 'send_forward_msg';
  const privateForm = getUserId(params.user_id) !== undefined && params.message_type !== 'group';
  const inPrecheck = PRIVATE_TARGET_PRECHECK.has(action) && (!conditionalEntry || privateForm);
  if (!inPrecheck) return { deny: false, inPrecheck: false };

  // 1. 参数熔断：私聊形态不允许携带 group_id；send_private_forward_msg 不允许 message_type=group。
  if (getGroupId(params.group_id) !== undefined) {
    return { deny: true, reason: `私聊目标 Action ${action} 不允许携带不可信 group_id 参数` };
  }
  if (action === 'send_private_forward_msg' && params.message_type === 'group') {
    return { deny: true, reason: `私聊目标 Action ${action} 不允许携带不可信 message_type=group 参数` };
  }
  // 2. 目标解析：无法解析出合法 user_id → 拒绝。
  const userId = getUserId(params.user_id);
  if (userId === undefined) {
    return { deny: true, reason: `私聊目标 Action ${action} 缺少合法 user_id 参数` };
  }
  // 3. 名单判定：名单非空且目标不在名单 → 拒绝；空名单表示联系人边界未启用，本层不拒绝。
  if (profile.allowedPrivateIds.length > 0 && !profile.allowedPrivateIds.includes(userId)) {
    return { deny: true, reason: `联系人 ${userId} 不在配置 ${profile.name} 的私聊白名单中` };
  }
  return { deny: false, inPrecheck: true, userId };
}

export function isActionAllowed(
  profile: NetworkProfile,
  action: string,
  params: Record<string, unknown>,
): { allowed: boolean; reason?: string } {
  if (!profile.strictActionGuard) return { allowed: true };
  const normalizedAction = normalizeActionName(action);
  // 私聊目标预检先于显式授权：确认目标私聊属主之前，allowedActions 不放行（§4.3）。
  const privateCheck = evaluatePrivateTarget(profile, normalizedAction, params);
  if (privateCheck.deny) return { allowed: false, reason: privateCheck.reason };
  // 请求名与 allowedActions 每一项都先归一化再比较，杜绝 _async / _rate_limited 后缀绕过。
  if (profile.allowedActions.some((name) => normalizeActionName(name) === normalizedAction)) return { allowed: true };
  // 私聊自动放行：名单非空且目标命中名单的 6 项 A 类免 allowedActions；空名单一律不自动放行。
  if (
    privateCheck.inPrecheck &&
    profile.allowedPrivateIds.length > 0 &&
    PRIVATE_AUTO_ALLOW_ACTIONS.has(normalizedAction)
  ) {
    return { allowed: true };
  }

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
  // B 类预检 Action：目标已通过预检（可解析、无 group_id 熔断、未被名单拒绝），仅缺
  // allowedActions 显式授权。返回准确理由，避免落到“无法关联到白名单群”误导用户去调群白名单。
  if (privateCheck.inPrecheck) {
    return {
      allowed: false,
      reason: profile.allowedPrivateIds.length > 0
        ? `Action ${action} 目标在联系人名单内，但未被 allowedActions 显式授权`
        : `Action ${action} 目标为有效私聊联系人，但未被 allowedActions 显式授权`,
    };
  }
  return { allowed: false, reason: `严格模式禁止无法关联到白名单群的 Action: ${action}` };
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
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

export type ActionResultAuthorization =
  | { allowed: true; data: unknown }
  | { allowed: false; reason: string };

// get_msg 结果授权（《最小变更方案 v5》§4.6）：结果里真正被允许的是「消息属主」，而不是请求参数。
function authorizeGetMsgResult(
  profile: NetworkProfile,
  data: unknown,
  context: { selfId: string },
): ActionResultAuthorization {
  const allowedGroups = new Set(profile.allowedGroupIds);
  // 联系人边界未启用（名单为空）：保持旧行为，不新增扣留，仅保留群结果过滤。
  if (profile.allowedPrivateIds.length === 0) {
    return { allowed: true, data: filterValue(data, allowedGroups) ?? null };
  }

  const object = asRecord(data);
  const messageType = object && typeof object.message_type === 'string' ? object.message_type : undefined;

  if (messageType === 'private') {
    // selfId 不可用时无法区分对端与机器人自身，fail-closed 扣留。
    const selfId = context.selfId;
    const selfAvailable = selfId !== '' && selfId !== '0';
    const userId = object ? getUserId(object.user_id) : undefined;
    if (!selfAvailable) {
      return { allowed: false, reason: 'selfId 不可用，无法确认 get_msg 私聊结果属主，扣留结果' };
    }
    if (userId === undefined) {
      return { allowed: false, reason: '无法从 get_msg 结果解析私聊属主 user_id，扣留结果' };
    }
    if (userId === selfId) {
      return { allowed: false, reason: 'get_msg 私聊结果为机器人自身消息，无法确定对端，扣留结果' };
    }
    if (!profile.allowedPrivateIds.includes(userId)) {
      return {
        allowed: false,
        reason: `联系人 ${userId} 不在配置 ${profile.name} 的私聊白名单中，扣留 get_msg 结果`,
      };
    }
    // 命中联系人即放行；临时会话即使带 group_id 也按 user_id 判定，不走群过滤分支。
    return { allowed: true, data };
  }

  if (messageType === 'group') {
    const groupId = object ? getGroupId(object.group_id) : undefined;
    if (groupId === undefined) {
      return { allowed: false, reason: '无法从 get_msg 结果解析群属主 group_id，扣留结果' };
    }
    if (!profile.allowedGroupIds.includes(groupId)) {
      return {
        allowed: false,
        reason: `群 ${groupId} 不在配置 ${profile.name} 的白名单中，扣留 get_msg 结果`,
      };
    }
    return { allowed: true, data: filterValue(data, allowedGroups) ?? null };
  }

  return { allowed: false, reason: '无法确定 get_msg 结果属主，扣留结果' };
}

export function filterActionResult(
  profile: NetworkProfile,
  action: string,
  data: unknown,
  context: { selfId: string },
): ActionResultAuthorization {
  if (!profile.strictActionGuard) return { allowed: true, data };
  if (normalizeActionName(action) === 'get_msg') return authorizeGetMsgResult(profile, data, context);
  return { allowed: true, data: filterValue(data, new Set(profile.allowedGroupIds)) ?? null };
}
