import assert from 'node:assert/strict';

import { normalizeConfig, V3_CONFIG_SCHEMA } from '../lib/core/config.js';

const run = async () => {
  assert.throws(
    () => normalizeConfig({ memoryRegistryPath: '/tmp/legacy.sqlite' }),
    /deprecated keys/i,
    'legacy key rejection must hard-fail in v3',
  );

  const config = normalizeConfig({
    runtime: {
      paths: {
        workspaceRoot: '/tmp/demo-workspace',
      },
    },
    dedupe: {
      autoThreshold: 0.85,
      reviewThreshold: 0.92,
    },
    recall: {
      classBudgets: {
        core: 2,
        situational: 1,
        decisions: 1,
      },
    },
  });

  assert.equal(config.dedupe.autoThreshold >= config.dedupe.reviewThreshold, true, 'auto threshold must be >= review threshold');
  const budgetTotal = config.recall.classBudgets.core + config.recall.classBudgets.situational + config.recall.classBudgets.decisions;
  assert.equal(Math.abs(budgetTotal - 1) < 0.00001, true, 'class budgets must normalize to 1');
  assert.equal(config.native.syncMode, 'hybrid', 'native sync mode should stay hybrid');
  assert.equal(Array.isArray(config.native.includeFiles), true, 'native include files should normalize to array');
  assert.equal(config.person.keepPublicFacts, true, 'person policy should keep public facts by default');
  assert.equal(config.capture.rememberIntent.enabled, true, 'remember intent should be enabled by default');
  assert.equal(Array.isArray(config.capture.rememberIntent.phrasesBase), true, 'remember intent phrases should normalize');
  assert.equal(config.capture.rememberIntent.writeNative, true, 'remember intent should dual-write to native by default');
  assert.equal(config.nativePromotion.enabled, true, 'native promotion should be enabled by default');
  assert.equal(Number(config.nativePromotion.minConfidence).toFixed(2), '0.72', 'native promotion threshold should default to 0.72');
  assert.equal(String(config.llm.taskProfiles.memory_review.model), 'qwen3.5:9b', 'memory review should default to qwen3.5:9b');
  assert.equal(Number(config.llm.taskProfiles.chat_general.temperature), 1, 'chat general should use official-ish default sampling');
  assert.equal(String(config.llm.review.profile), 'memory_review', 'review profile should default to memory_review');
  assert.equal(String(config.vault.subdir), 'Gigabrain', 'vault mirror should default to Gigabrain subdir');
  assert.equal(String(config.vault.homeNoteName), 'Home', 'vault home note should default to Home');
  assert.deepEqual(config.vault.manualFolders, ['Inbox', 'Manual'], 'vault manual folders should normalize');
  assert.equal(config.vault.views.enabled, true, 'vault views should be enabled by default');
  assert.equal(Object.keys(V3_CONFIG_SCHEMA.properties || {}).length <= 25, true, 'top-level config keys must stay lean');
};

export { run };
