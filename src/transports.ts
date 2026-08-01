import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import WebSocket, { WebSocketServer, type RawData } from 'ws';
import type {
  NetworkProfile,
  NetworkTransport,
  OneBotEvent,
  TransportDependencies,
} from './types.js';

function serialize(value: unknown): string {
  return JSON.stringify(value, (_key, item) => (typeof item === 'bigint' ? item.toString() : item));
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    throw new Error('请求内容不是合法 JSON');
  }
}

function getRequestUrl(request: IncomingMessage): URL {
  return new URL(request.url ?? '/', `http://${request.headers.host ?? '127.0.0.1'}`);
}

function getBearerToken(request: IncomingMessage): string {
  const authorization = request.headers.authorization ?? '';
  if (authorization.toLowerCase().startsWith('bearer ')) return authorization.slice(7).trim();
  return getRequestUrl(request).searchParams.get('access_token') ?? '';
}

function isAuthorized(request: IncomingMessage, accessToken: string): boolean {
  if (!accessToken) return true;
  return getBearerToken(request) === accessToken;
}

function writeJson(response: ServerResponse, statusCode: number, payload: unknown): void {
  const body = serialize(payload);
  response.writeHead(statusCode, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
  });
  response.end(body);
}

async function readBody(request: IncomingMessage, maxBytes = 2 * 1024 * 1024): Promise<string> {
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    bytes += buffer.length;
    if (bytes > maxBytes) throw new Error('请求体超过 2 MiB 限制');
    chunks.push(buffer);
  }
  return Buffer.concat(chunks).toString('utf8');
}

function lifecycleEvent(selfId: string): OneBotEvent {
  return {
    time: Math.floor(Date.now() / 1000),
    self_id: /^\d+$/.test(selfId) ? Number(selfId) : selfId,
    post_type: 'meta_event',
    meta_event_type: 'lifecycle',
    sub_type: 'connect',
  };
}

function heartbeatEvent(selfId: string, interval: number): OneBotEvent {
  return {
    time: Math.floor(Date.now() / 1000),
    self_id: /^\d+$/.test(selfId) ? Number(selfId) : selfId,
    post_type: 'meta_event',
    meta_event_type: 'heartbeat',
    status: { online: true, good: true },
    interval,
  };
}

abstract class BaseTransport implements NetworkTransport {
  protected heartbeatTimer?: NodeJS.Timeout;

  constructor(
    public readonly profile: NetworkProfile,
    protected readonly dependencies: TransportDependencies,
  ) {}

  abstract start(): Promise<void>;
  abstract stop(): Promise<void>;
  abstract forwardEvent(event: OneBotEvent): void;

  protected logDebug(message: string): void {
    if (this.dependencies.debug) {
      this.dependencies.logger.debug(`[${this.profile.name}] ${message}`);
    }
  }

  protected startHeartbeat(send: (event: OneBotEvent) => void): void {
    const interval = this.profile.heartbeatIntervalMs;
    if (interval <= 0) return;
    this.stopHeartbeat();
    this.heartbeatTimer = setInterval(() => send(heartbeatEvent(this.dependencies.selfId, interval)), interval);
  }

  protected stopHeartbeat(): void {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = undefined;
  }

  protected async handleWebSocketMessage(socket: WebSocket, data: RawData): Promise<void> {
    try {
      const payload = parseJson(data.toString());
      const response = await this.dependencies.executeAction(this.profile, payload);
      if (socket.readyState === WebSocket.OPEN) socket.send(serialize(response));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (socket.readyState === WebSocket.OPEN) {
        socket.send(serialize({ status: 'failed', retcode: 1400, data: null, message, wording: message }));
      }
    }
  }
}

class WebSocketServerTransport extends BaseTransport {
  private httpServer?: Server;
  private websocketServer?: WebSocketServer;
  private readonly clients = new Set<WebSocket>();

  async start(): Promise<void> {
    this.httpServer = createServer((_request, response) => {
      writeJson(response, 404, { status: 'failed', retcode: 1404, message: '请使用 WebSocket 连接' });
    });
    this.websocketServer = new WebSocketServer({ noServer: true });

    this.httpServer.on('upgrade', (request, socket, head) => {
      const pathname = getRequestUrl(request).pathname.replace(/\/+$/, '') || '/';
      if (pathname !== '/' || !isAuthorized(request, this.profile.accessToken)) {
        socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');
        socket.destroy();
        return;
      }
      this.websocketServer?.handleUpgrade(request, socket, head, (client) => {
        this.websocketServer?.emit('connection', client, request);
      });
    });

    this.websocketServer.on('connection', (socket) => {
      this.clients.add(socket);
      socket.send(serialize(lifecycleEvent(this.dependencies.selfId)));
      socket.on('message', (data) => void this.handleWebSocketMessage(socket, data));
      socket.on('error', (error) => this.dependencies.logger.warn(`[${this.profile.name}] WS 客户端异常: ${error.message}`));
      socket.on('close', () => this.clients.delete(socket));
    });

    await new Promise<void>((resolve, reject) => {
      this.httpServer?.once('error', reject);
      this.httpServer?.listen(this.profile.port, this.profile.host, () => resolve());
    });
    this.startHeartbeat((event) => this.broadcast(event));
    this.dependencies.logger.info(
      `[${this.profile.name}] WebSocket 服务端已监听 ws://${this.profile.host}:${this.profile.port}/`,
    );
  }

  async stop(): Promise<void> {
    this.stopHeartbeat();
    for (const client of this.clients) client.close(1001, '插件停止');
    this.clients.clear();
    this.websocketServer?.close();
    this.websocketServer = undefined;
    if (this.httpServer) {
      await new Promise<void>((resolve) => this.httpServer?.close(() => resolve()));
      this.httpServer = undefined;
    }
  }

  forwardEvent(event: OneBotEvent): void {
    this.broadcast(event);
  }

  private broadcast(event: OneBotEvent): void {
    const payload = serialize(event);
    for (const client of this.clients) {
      if (client.readyState === WebSocket.OPEN) client.send(payload);
    }
  }
}

class WebSocketClientTransport extends BaseTransport {
  private socket?: WebSocket;
  private reconnectTimer?: NodeJS.Timeout;
  private stopping = false;

  async start(): Promise<void> {
    if (!this.profile.url) throw new Error('WebSocket 客户端配置缺少 url');
    this.stopping = false;
    this.connect();
  }

  async stop(): Promise<void> {
    this.stopping = true;
    this.stopHeartbeat();
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = undefined;
    this.socket?.close(1001, '插件停止');
    this.socket = undefined;
  }

  forwardEvent(event: OneBotEvent): void {
    if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(serialize(event));
  }

  private connect(): void {
    if (this.stopping) return;
    const headers: Record<string, string> = {
      ...this.profile.headers,
      'X-Self-ID': this.dependencies.selfId,
      'X-Client-Role': 'Universal',
      'User-Agent': 'OneBot/11',
    };
    if (this.profile.accessToken) headers.Authorization = `Bearer ${this.profile.accessToken}`;

    const socket = new WebSocket(this.profile.url, { headers });
    this.socket = socket;
    socket.on('open', () => {
      this.dependencies.logger.info(`[${this.profile.name}] 已连接 ${this.profile.url}`);
      socket.send(serialize(lifecycleEvent(this.dependencies.selfId)));
      this.startHeartbeat((event) => this.forwardEvent(event));
    });
    socket.on('message', (data) => void this.handleWebSocketMessage(socket, data));
    socket.on('error', (error) => this.dependencies.logger.warn(`[${this.profile.name}] WS 连接异常: ${error.message}`));
    socket.on('close', () => {
      this.stopHeartbeat();
      if (this.socket === socket) this.socket = undefined;
      if (!this.stopping) {
        this.reconnectTimer = setTimeout(() => this.connect(), this.profile.reconnectIntervalMs);
      }
    });
  }
}

class HttpServerTransport extends BaseTransport {
  private server?: Server;

  async start(): Promise<void> {
    this.server = createServer((request, response) => void this.handleRequest(request, response));
    await new Promise<void>((resolve, reject) => {
      this.server?.once('error', reject);
      this.server?.listen(this.profile.port, this.profile.host, () => resolve());
    });
    this.dependencies.logger.info(
      `[${this.profile.name}] HTTP Action 服务端已监听 http://${this.profile.host}:${this.profile.port}${this.profile.path}`,
    );
  }

  async stop(): Promise<void> {
    if (this.server) {
      await new Promise<void>((resolve) => this.server?.close(() => resolve()));
      this.server = undefined;
    }
  }

  forwardEvent(_event: OneBotEvent): void {
    // OneBot HTTP Action 服务端不主动推送事件；事件推送由 http-client 配置负责。
  }

  private async handleRequest(request: IncomingMessage, response: ServerResponse): Promise<void> {
    try {
      if (!isAuthorized(request, this.profile.accessToken)) {
        writeJson(response, 401, { status: 'failed', retcode: 1401, data: null, message: 'Access Token 无效' });
        return;
      }

      const url = getRequestUrl(request);
      const basePath = this.profile.path;
      const actionFromPath = basePath === '/'
        ? url.pathname.slice(1)
        : url.pathname.startsWith(`${basePath}/`)
          ? url.pathname.slice(basePath.length + 1)
          : '';

      if (request.method === 'GET') {
        if (!actionFromPath) throw new Error('GET 请求路径必须包含 Action 名称');
        const params = Object.fromEntries(
          [...url.searchParams.entries()].filter(([key]) => key !== 'access_token'),
        );
        writeJson(response, 200, await this.dependencies.executeAction(this.profile, { action: actionFromPath, params }));
        return;
      }

      if (request.method !== 'POST') {
        writeJson(response, 405, { status: 'failed', retcode: 1405, data: null, message: '仅支持 GET/POST' });
        return;
      }

      const bodyText = await readBody(request);
      const contentType = request.headers['content-type'] ?? '';
      let body: unknown;
      if (contentType.includes('application/x-www-form-urlencoded')) {
        body = Object.fromEntries(new URLSearchParams(bodyText));
      } else {
        body = bodyText ? parseJson(bodyText) : {};
      }

      const payload = actionFromPath
        ? { action: actionFromPath, params: body }
        : body;
      writeJson(response, 200, await this.dependencies.executeAction(this.profile, payload));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      writeJson(response, 400, { status: 'failed', retcode: 1400, data: null, message, wording: message });
    }
  }
}

class HttpClientTransport extends BaseTransport {
  private readonly queue: OneBotEvent[] = [];
  private processing = false;
  private stopping = false;

  async start(): Promise<void> {
    if (!this.profile.url) throw new Error('HTTP 客户端配置缺少 url');
    this.stopping = false;
    this.dependencies.logger.info(`[${this.profile.name}] HTTP 事件将推送至 ${this.profile.url}`);
    this.forwardEvent(lifecycleEvent(this.dependencies.selfId));
  }

  async stop(): Promise<void> {
    this.stopping = true;
    this.queue.length = 0;
  }

  forwardEvent(event: OneBotEvent): void {
    if (this.stopping) return;
    if (this.queue.length >= this.profile.maxPendingEvents) {
      this.queue.shift();
      this.dependencies.logger.warn(`[${this.profile.name}] HTTP 事件队列已满，已丢弃最早事件`);
    }
    this.queue.push(event);
    void this.processQueue();
  }

  private async processQueue(): Promise<void> {
    if (this.processing) return;
    this.processing = true;
    try {
      while (!this.stopping && this.queue.length > 0) {
        const event = this.queue.shift();
        if (event) await this.postEvent(event);
      }
    } finally {
      this.processing = false;
    }
  }

  private async postEvent(event: OneBotEvent): Promise<void> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.profile.requestTimeoutMs);
    const headers: Record<string, string> = {
      'content-type': 'application/json',
      'x-self-id': this.dependencies.selfId,
      'x-post-type': String(event.post_type ?? ''),
      ...this.profile.headers,
    };
    if (this.profile.accessToken) headers.Authorization = `Bearer ${this.profile.accessToken}`;

    try {
      const response = await fetch(this.profile.url, {
        method: 'POST',
        headers,
        body: serialize(event),
        signal: controller.signal,
      });
      if (!response.ok) {
        this.dependencies.logger.warn(`[${this.profile.name}] HTTP 推送失败: ${response.status} ${response.statusText}`);
        return;
      }
      const responseText = await response.text();
      if (responseText.trim()) {
        try {
          await this.dependencies.executeQuickOperation(this.profile, event, parseJson(responseText));
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          this.dependencies.logger.warn(`[${this.profile.name}] HTTP 快速操作处理失败: ${message}`);
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.dependencies.logger.warn(`[${this.profile.name}] HTTP 推送异常: ${message}`);
    } finally {
      clearTimeout(timeout);
    }
  }
}

export function createTransport(
  profile: NetworkProfile,
  dependencies: TransportDependencies,
): NetworkTransport {
  switch (profile.transport) {
    case 'websocket-server':
      return new WebSocketServerTransport(profile, dependencies);
    case 'websocket-client':
      return new WebSocketClientTransport(profile, dependencies);
    case 'http-server':
      return new HttpServerTransport(profile, dependencies);
    case 'http-client':
      return new HttpClientTransport(profile, dependencies);
  }
}
