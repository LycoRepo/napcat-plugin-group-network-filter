import { readFileSync, writeFileSync } from 'node:fs';
import { builtinModules } from 'node:module';
import { resolve } from 'node:path';
import { defineConfig } from 'vite';

const NODE_BUILTINS = new Set([
  ...builtinModules,
  ...builtinModules.map((moduleName) => `node:${moduleName}`),
]);

function deploymentManifestPlugin() {
  return {
    name: 'deployment-manifest',
    closeBundle() {
      const sourcePackage = JSON.parse(
        readFileSync(resolve(__dirname, 'package.json'), 'utf8'),
      ) as Record<string, unknown>;
      const deploymentPackage = {
        name: sourcePackage.name,
        plugin: sourcePackage.plugin,
        version: sourcePackage.version,
        type: 'module',
        description: sourcePackage.description,
        main: 'index.mjs',
        author: sourcePackage.author,
        license: sourcePackage.license,
        napcat: sourcePackage.napcat,
      };
      writeFileSync(
        resolve(__dirname, 'dist/package.json'),
        `${JSON.stringify(deploymentPackage, null, 2)}\n`,
        'utf8',
      );
    },
  };
}

export default defineConfig({
  plugins: [deploymentManifestPlugin()],
  define: {
    // 禁用 ws 的可选原生模块，确保 Windows 构建产物可在 Linux/Docker 中运行。
    'process.env.WS_NO_BUFFER_UTIL': JSON.stringify('1'),
    'process.env.WS_NO_UTF_8_VALIDATE': JSON.stringify('1'),
  },
  resolve: {
    // ws 同时发布浏览器占位模块与 Node.js 实现，必须明确选择 Node.js 条件。
    conditions: ['node'],
    mainFields: ['module', 'main'],
  },
  build: {
    lib: {
      entry: resolve(__dirname, 'src/index.ts'),
      formats: ['es'],
      fileName: () => 'index.mjs',
    },
    outDir: 'dist',
    emptyOutDir: true,
    target: 'node18',
    rollupOptions: {
      // NapCat 插件运行在 Node.js 中，内置模块应由宿主运行时提供。
      external: (moduleId) => NODE_BUILTINS.has(moduleId),
    },
  },
});
