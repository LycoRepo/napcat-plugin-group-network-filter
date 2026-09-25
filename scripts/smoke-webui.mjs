import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const temporaryDirectory = await mkdtemp(join(tmpdir(), 'napcat-filter-webui-'));
let plugin;
let context;

try {
  const configPath = join(temporaryDirectory, 'config.json');
  await writeFile(configPath, JSON.stringify({
    enabled: false,
    debug: false,
    profilesJson: '[]',
  }), 'utf8');

  plugin = await import(`../dist/index.mjs?webui-smoke=${Date.now()}`);
  context = {
    actions: { call: async () => ({ user_id: 10000 }) },
    pluginName: 'napcat-plugin-group-network-filter',
    pluginPath: temporaryDirectory,
    configPath,
    dataPath: temporaryDirectory,
    adapterName: 'smoke-test',
    pluginManager: { config: {} },
    logger: { log() {}, debug() {}, info() {}, warn() {}, error() {} },
    router: { get() {}, post() {}, page() {} },
  };

  await plugin.plugin_init(context);
  const html = await readFile(join(temporaryDirectory, 'group-network-filter-webui.html'), 'utf8');
  const scriptMatch = html.match(/<script>([\s\S]*)<\/script>/);
  if (!scriptMatch) throw new Error('WebUI 缺少脚本');
  // 只编译脚本，不执行浏览器逻辑。
  new Function(scriptMatch[1]);

  const requiredText = ['config-card', 'modal-backdrop', '新增配置', '编辑网络配置', 'type="text" autocomplete="off"', 'name="allowedPrivateIds"', '<span>联系人</span>', 'profile-private-contacts', '留空表示沿用旧行为'];
  for (const text of requiredText) {
    if (!html.includes(text)) throw new Error(`WebUI 缺少关键内容: ${text}`);
  }
  const forbiddenText = ['保存并应用', '配置 ID', 'profile-id', 'name="id"'];
  for (const text of forbiddenText) {
    if (html.includes(text)) throw new Error(`WebUI 包含不应显示的内容: ${text}`);
  }
  console.log('WEBUI_SMOKE_OK card-modal-instant-save');
} finally {
  if (plugin && context) await plugin.plugin_cleanup(context);
  await rm(temporaryDirectory, { recursive: true, force: true });
}
