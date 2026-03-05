#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { openDatabase } from '../lib/core/sqlite.js';
import { ensureProjectionStore, materializeProjectionFromMemories } from '../lib/core/projection-store.js';
import { ensureEventStore } from '../lib/core/event-store.js';
import { ensureNativeStore, syncNativeMemory } from '../lib/core/native-sync.js';
import { ensurePersonStore, rebuildEntityMentions } from '../lib/core/person-service.js';
import { loadResolvedConfig } from '../lib/core/config.js';

const HELP = `Gigabrain first-run setup

Usage:
  npm run setup
  npm run setup -- --config ~/.openclaw/openclaw.json --workspace ~/my-workspace
  npm run setup -- --skip-agents --skip-restart

Flags:
  --config <path>       Path to openclaw.json (default: ~/.openclaw/openclaw.json or $OPENCLAW_CONFIG)
  --workspace <path>    Workspace root for Gigabrain runtime paths
  --plugin-path <path>  Gigabrain plugin path (default: current directory)
  --agents-path <path>  AGENTS.md path (default: <workspace>/AGENTS.md)
  --skip-agents         Do not add/update AGENTS.md memory protocol block
  --skip-restart        Do not run 'openclaw gateway restart'
  --help                Print this help
`;

const START_MARKER = '<!-- GIGABRAIN_MEMORY_PROTOCOL_START -->';
const END_MARKER = '<!-- GIGABRAIN_MEMORY_PROTOCOL_END -->';
const MEMORY_BLOCK = `${START_MARKER}
## Memory

Gigabrain handles memory capture and recall automatically.

### Memory Note Protocol

When the user explicitly asks you to remember or save something
(for example: "remember that", "save this", "note that I prefer X"):

1. Emit a \`<memory_note>\` tag with the fact:
   \`\`\`xml
   <memory_note type="USER_FACT" confidence="0.9">Concrete fact here.</memory_note>
   \`\`\`
2. Use one tag per fact.
3. Keep facts short, concrete, and self-contained.
4. Choose the appropriate type (USER_FACT, PREFERENCE, DECISION, ENTITY, EPISODE, AGENT_IDENTITY).

When the user does NOT explicitly ask to save memory:
- Do NOT emit \`<memory_note>\` tags.
- Normal conversation does not trigger memory capture.

Never include secrets, credentials, tokens, or API keys in memory notes.
${END_MARKER}
`;

const args = process.argv.slice(2);
const readFlag = (name, fallback = '') => {
  const idx = args.indexOf(name);
  if (idx !== -1 && args[idx + 1] && !String(args[idx + 1]).startsWith('--')) return String(args[idx + 1]);
  const withEq = args.find((item) => String(item || '').startsWith(`${name}=`));
  if (withEq) return String(withEq.split('=').slice(1).join('='));
  return fallback;
};
const hasFlag = (name) => args.includes(name);

const expandHome = (value) => {
  const raw = String(value || '').trim();
  if (!raw) return raw;
  if (raw === '~') return os.homedir();
  if (raw.startsWith('~/')) return path.join(os.homedir(), raw.slice(2));
  return raw;
};

const resolveAbsolute = (value) => path.resolve(expandHome(value));

const defaultOpenclawConfigPath = () => {
  const fromEnv = expandHome(process.env.OPENCLAW_CONFIG || '');
  if (fromEnv) return resolveAbsolute(fromEnv);
  return path.join(os.homedir(), '.openclaw', 'openclaw.json');
};

const readJson = (filePath, fallback) => {
  if (!fs.existsSync(filePath)) return fallback;
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
};

const ensureDir = (dirPath) => {
  fs.mkdirSync(dirPath, { recursive: true });
};

const ensureObject = (parent, key) => {
  if (!parent[key] || typeof parent[key] !== 'object' || Array.isArray(parent[key])) {
    parent[key] = {};
  }
  return parent[key];
};

const upsertAgentsBlock = (agentsPath) => {
  const targetDir = path.dirname(agentsPath);
  ensureDir(targetDir);
  const existing = fs.existsSync(agentsPath) ? fs.readFileSync(agentsPath, 'utf8') : '';
  if (existing.includes(START_MARKER) && existing.includes(END_MARKER)) {
    return { changed: false, path: agentsPath };
  }
  const next = existing.trim().length > 0
    ? `${existing.trimEnd()}\n\n${MEMORY_BLOCK}\n`
    : `${MEMORY_BLOCK}\n`;
  fs.writeFileSync(agentsPath, next, 'utf8');
  return { changed: true, path: agentsPath };
};

const writeJsonPretty = (filePath, obj) => {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, `${JSON.stringify(obj, null, 2)}\n`, 'utf8');
};

const run = (cmd, cmdArgs, options = {}) => {
  const child = spawnSync(cmd, cmdArgs, {
    stdio: 'inherit',
    ...options,
  });
  return child.status === 0;
};

const bootstrapDatabase = ({ configPath, workspaceRoot }) => {
  const loaded = loadResolvedConfig({
    configPath,
    workspaceRoot,
  });
  const config = loaded.config;
  const dbPath = path.resolve(String(config?.runtime?.paths?.registryPath || ''));
  if (!dbPath) throw new Error('Could not resolve registry path from config');
  ensureDir(path.dirname(dbPath));

  const db = openDatabase(dbPath);
  let projectionImport = 0;
  let nativeChangedFiles = 0;
  let nativeInsertedChunks = 0;
  try {
    ensureProjectionStore(db);
    ensureEventStore(db);
    ensureNativeStore(db);
    ensurePersonStore(db);
    const imported = materializeProjectionFromMemories(db);
    projectionImport = Number(imported?.imported || 0);
    const nativeResult = syncNativeMemory({
      db,
      config,
      dryRun: false,
    });
    nativeChangedFiles = Number(nativeResult?.changed_files || 0);
    nativeInsertedChunks = Number(nativeResult?.inserted_chunks || 0);
    rebuildEntityMentions(db);
  } finally {
    db.close();
  }
  return {
    dbPath,
    projectionImport,
    nativeChangedFiles,
    nativeInsertedChunks,
  };
};

const main = () => {
  if (hasFlag('--help') || hasFlag('-h')) {
    console.log(HELP.trim());
    return;
  }

  const configPath = resolveAbsolute(readFlag('--config', defaultOpenclawConfigPath()));
  const pluginPath = resolveAbsolute(readFlag('--plugin-path', process.cwd()));
  const requestedWorkspace = readFlag('--workspace', '');
  const skipAgents = hasFlag('--skip-agents');
  const skipRestart = hasFlag('--skip-restart');

  const openclawConfig = readJson(configPath, {});
  if (!openclawConfig || typeof openclawConfig !== 'object' || Array.isArray(openclawConfig)) {
    throw new Error(`openclaw config at ${configPath} is not a JSON object`);
  }

  const plugins = ensureObject(openclawConfig, 'plugins');
  const entries = ensureObject(plugins, 'entries');
  const gigabrain = ensureObject(entries, 'gigabrain');
  const gigabrainConfig = ensureObject(gigabrain, 'config');
  const runtime = ensureObject(gigabrainConfig, 'runtime');
  const runtimePaths = ensureObject(runtime, 'paths');

  const existingWorkspace = String(runtimePaths.workspaceRoot || '').trim();
  const workspaceRoot = resolveAbsolute(
    requestedWorkspace
      || existingWorkspace
      || process.env.OPENCLAW_WORKSPACE_ROOT
      || path.join(os.homedir(), '.openclaw', 'gigabrain-workspace'),
  );
  const registryPath = resolveAbsolute(
    String(runtimePaths.registryPath || '').trim()
      || path.join(workspaceRoot, 'memory', 'registry.sqlite'),
  );
  const memoryRootRaw = String(runtimePaths.memoryRoot || 'memory').trim() || 'memory';
  const outputDirRaw = String(runtimePaths.outputDir || 'output').trim() || 'output';
  const memoryRootPath = path.isAbsolute(memoryRootRaw)
    ? memoryRootRaw
    : path.join(workspaceRoot, memoryRootRaw);
  const outputDirPath = path.isAbsolute(outputDirRaw)
    ? outputDirRaw
    : path.join(workspaceRoot, outputDirRaw);

  gigabrain.path = pluginPath;
  gigabrain.enabled = true;
  gigabrainConfig.enabled = true;
  runtimePaths.workspaceRoot = workspaceRoot;
  runtimePaths.registryPath = registryPath;

  ensureDir(workspaceRoot);
  ensureDir(memoryRootPath);
  ensureDir(outputDirPath);
  ensureDir(path.dirname(registryPath));

  writeJsonPretty(configPath, openclawConfig);
  const bootstrap = bootstrapDatabase({
    configPath,
    workspaceRoot,
  });

  let agentsResult = { changed: false, path: '' };
  if (!skipAgents) {
    const agentsPath = resolveAbsolute(readFlag('--agents-path', path.join(workspaceRoot, 'AGENTS.md')));
    agentsResult = upsertAgentsBlock(agentsPath);
  }

  let restartOk = true;
  if (!skipRestart) {
    restartOk = run('openclaw', ['gateway', 'restart']);
  }

  const summary = {
    ok: true,
    configPath,
    pluginPath,
    workspaceRoot,
    registryPath: bootstrap.dbPath,
    bootstrap,
    agents: skipAgents ? 'skipped' : (agentsResult.changed ? `updated:${agentsResult.path}` : `already_present:${agentsResult.path}`),
    gatewayRestart: skipRestart ? 'skipped' : (restartOk ? 'ok' : 'failed'),
    nextStep: restartOk || skipRestart
      ? 'Run a chat and try: "Remember that my preference is concise status updates."'
      : "Run 'openclaw gateway restart' manually, then test memory capture.",
  };
  console.log(JSON.stringify(summary, null, 2));
};

main();
