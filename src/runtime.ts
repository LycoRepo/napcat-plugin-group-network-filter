import type { NapCatPluginContext } from './napcat-api.js';
import { filterActionResult, isActionAllowed, shouldForwardEvent } from './filter.js';
import { createTransport } from './transports.js';
import type {
  NetworkProfile,
  NetworkTransport,
  OneBotActionRequest,
  OneBotActionResponse,
  OneBotEvent,
  PluginConfig,
} from './types.js';
import { parseProfiles } from './config.js';

function asObject(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function actionRequest(value: unknown): OneBotActionRequest {
  const object = asObject(value);
  if (!object || typeof object.action !== 'string' || !object.action.trim()) {
    throw new Error('Action 请求必须包含非空 action 字段');
  }
  const params = asObject(object.params) ?? {};
  return { action: object.action, params, echo: object.echo };
}

export class GatewayRuntime {
  private transports: NetworkTransport[] = [];
  private selfId = '0';

  constructor(private readonly context: NapCatPluginContext) {}

  async restart(config: PluginConfig): Promise<void> {
    await this.stop();
    if (!config.enabled) {
      this.context.logger.info('群网络过滤插件当前已禁用');
      return;
    }

    try {
      const loginInfo = await this.callNapCat('get_login_info', {});
      const userId = asObject(loginInfo)?.user_id;
      if (typeof userId === 'string' || typeof userId === 'number') this.selfId = String(userId);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.context.logger.warn(`获取登录账号失败，将暂用 self_id=0: ${message}`);
    }

    let profiles: NetworkProfile[];
    try {
      profiles = parseProfiles(config.profilesJson).filter((profile) => profile.enabled);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.context.logger.error(`网络配置解析失败: ${message}`);
      return;
    }

    const dependencies = {
      logger: this.context.logger,
      debug: config.debug,
      selfId: this.selfId,
      executeAction: (profile: NetworkProfile, payload: unknown) => this.executeAction(profile, payload),
      executeQuickOperation: (profile: NetworkProfile, event: OneBotEvent, payload: unknown) =>
        this.executeQuickOperation(profile, event, payload),
    };

    for (const profile of profiles) {
      const transport = createTransport(profile, dependencies);
      try {
        await transport.start();
        this.transports.push(transport);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.context.logger.error(`[${profile.name}] 启动失败: ${message}`);
        await transport.stop().catch(() => undefined);
      }
    }
    this.context.logger.info(`群网络过滤插件已启动 ${this.transports.length} 个网络配置`);
  }

  async stop(): Promise<void> {
    const transports = this.transports.splice(0);
    await Promise.allSettled(transports.map((transport) => transport.stop()));
  }

  forwardEvent(event: OneBotEvent): void {
    for (const transport of this.transports) {
      if (shouldForwardEvent(transport.profile, event)) transport.forwardEvent(event);
    }
  }

  getActiveTransportCount(): number {
    return this.transports.length;
  }

  private async executeAction(
    profile: NetworkProfile,
    payload: unknown,
  ): Promise<OneBotActionResponse> {
    let request: OneBotActionRequest;
    try {
      request = actionRequest(payload);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { status: 'failed', retcode: 1400, data: null, message, wording: message };
    }

    const params = request.params ?? {};
    const permission = isActionAllowed(profile, request.action, params);
    if (!permission.allowed) {
      return {
        status: 'failed',
        retcode: 1403,
        data: null,
        message: permission.reason,
        wording: permission.reason,
        echo: request.echo,
      };
    }

    try {
      const result = await this.callNapCat(request.action, params);
      // get_msg 结果按消息属主授权；selfId 在实例绑定时已取得（《最小变更方案 v5》§4.10）。
      const authorization = filterActionResult(profile, request.action, result, { selfId: this.selfId });
      if (!authorization.allowed) {
        return {
          status: 'failed',
          retcode: 1403,
          data: null,
          message: authorization.reason,
          wording: authorization.reason,
          echo: request.echo,
        };
      }
      return {
        status: 'ok',
        retcode: 0,
        data: authorization.data,
        echo: request.echo,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        status: 'failed',
        retcode: 100,
        data: null,
        message,
        wording: message,
        echo: request.echo,
      };
    }
  }

  private async executeQuickOperation(
    profile: NetworkProfile,
    event: OneBotEvent,
    payload: unknown,
  ): Promise<void> {
    if (Array.isArray(payload)) {
      for (const item of payload) await this.executeQuickOperation(profile, event, item);
      return;
    }
    const operation = asObject(payload);
    if (!operation) return;

    if (typeof operation.action === 'string') {
      await this.executeAction(profile, operation);
      return;
    }

    const messageId = event.message_id;
    const groupId = event.group_id;
    const userId = event.user_id ?? asObject(event.sender)?.user_id;
    if (operation.reply !== undefined && event.post_type === 'message') {
      const action = groupId !== undefined ? 'send_group_msg' : 'send_private_msg';
      const params = groupId !== undefined
        ? { group_id: groupId, message: operation.reply, auto_escape: operation.auto_escape ?? false }
        : { user_id: userId, message: operation.reply, auto_escape: operation.auto_escape ?? false };
      await this.executeAction(profile, { action, params });
    }
    if (operation.delete === true && messageId !== undefined) {
      await this.executeAction(profile, { action: 'delete_msg', params: { message_id: messageId, group_id: groupId } });
    }
    if (operation.kick === true && groupId !== undefined && userId !== undefined) {
      await this.executeAction(profile, { action: 'set_group_kick', params: { group_id: groupId, user_id: userId } });
    }
    if (operation.ban === true && groupId !== undefined && userId !== undefined) {
      await this.executeAction(profile, {
        action: 'set_group_ban',
        params: { group_id: groupId, user_id: userId, duration: operation.ban_duration ?? 1800 },
      });
    }
    if (event.post_type === 'request' && typeof operation.approve === 'boolean') {
      const flag = event.flag;
      if (event.request_type === 'friend') {
        await this.executeAction(profile, {
          action: 'set_friend_add_request',
          params: { flag, approve: operation.approve, remark: operation.remark ?? '' },
        });
      } else if (event.request_type === 'group') {
        await this.executeAction(profile, {
          action: 'set_group_add_request',
          params: { flag, sub_type: event.sub_type, approve: operation.approve, reason: operation.reason ?? '' },
        });
      }
    }
  }

  private async callNapCat(action: string, params: Record<string, unknown>): Promise<unknown> {
    const call = this.context.actions.call as unknown as (
      actionName: string,
      actionParams: Record<string, unknown>,
      adapterName: string,
      config: unknown,
    ) => Promise<unknown>;
    return call(action, params, this.context.adapterName, this.context.pluginManager.config);
  }
}
