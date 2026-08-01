import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { NapCatPluginContext } from './napcat-api.js';
import { DEFAULT_CONFIG, normalizeConfig } from './config.js';
import type { PluginConfig } from './types.js';

export class ConfigStore {
  private config: PluginConfig = { ...DEFAULT_CONFIG };

  constructor(private readonly context: NapCatPluginContext) {}

  load(): PluginConfig {
    try {
      if (existsSync(this.context.configPath)) {
        const raw = JSON.parse(readFileSync(this.context.configPath, 'utf8')) as unknown;
        this.config = normalizeConfig(raw);
      } else {
        this.save(DEFAULT_CONFIG);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.context.logger.error(`读取插件配置失败，已使用默认配置: ${message}`);
      this.config = { ...DEFAULT_CONFIG };
    }
    return this.get();
  }

  get(): PluginConfig {
    return { ...this.config };
  }

  save(value: unknown): PluginConfig {
    this.config = normalizeConfig(value);
    mkdirSync(dirname(this.context.configPath), { recursive: true });
    writeFileSync(this.context.configPath, JSON.stringify(this.config, null, 2), 'utf8');
    return this.get();
  }
}
