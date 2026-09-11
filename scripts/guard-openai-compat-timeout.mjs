#!/usr/bin/env node
/**
 * scripts/guard-openai-compat-timeout.mjs
 *
 * Guard to verify if upstream or local codebase still requires the custom
 * renewable idle stream timeout patch, or if upstream has natively implemented
 * an equivalent idle timeout mechanism.
 *
 * Usage:
 *   node scripts/guard-openai-compat-timeout.mjs [target_repo_path]
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const defaultDir = path.resolve(__dirname, '..');
const rootDir = process.argv[2] ? path.resolve(process.argv[2]) : defaultDir;

const chatFile = path.join(rootDir, 'server/drivers/openai-chat.ts');
const compatFile = path.join(rootDir, 'server/drivers/openai-compat.ts');
const testFile = path.join(rootDir, 'server/drivers/openai-compat.test.ts');

function checkFile(filePath, desc) {
  if (!fs.existsSync(filePath)) {
    console.error(`[FAIL] Required file not found: ${filePath} (${desc})`);
    return null;
  }
  return fs.readFileSync(filePath, 'utf8');
}

const chatContent = checkFile(chatFile, 'OpenAI Chat Runtime');
const compatContent = checkFile(compatFile, 'OpenAI Compat Driver');
const testContent = checkFile(testFile, 'OpenAI Compat Tests');

if (!chatContent || !compatContent || !testContent) {
  process.exit(1);
}

// 1. Check for legacy absolute timeout bug
const hasStaticTimeout = chatContent.includes('const timeout = AbortSignal.timeout(options.timeoutMs)') ||
  (chatContent.includes('AbortSignal.timeout(') && !chatContent.includes('resetIdleTimer'));

// 2. Check for renewable idle timeout
const hasRenewableIdleTimer = chatContent.includes('resetIdleTimer') ||
  (chatContent.includes('idleTimer') && chatContent.includes('clearTimeout'));

// 3. Check for chunk-level reset in stream read loop
const hasChunkReset = chatContent.includes('resetIdleTimer()') &&
  chatContent.includes('reader.read()');

// 4. Check for idle timeout configuration in openai-compat.ts
const hasConfigurableIdleTimeout = compatContent.includes('OPENMAUS_OPENAI_COMPAT_IDLE_TIMEOUT_MS') ||
  compatContent.includes('idleTimeoutMs') ||
  compatContent.includes('idleTimeout');

// 5. Check test coverage
const hasIdleTimeoutTests = testContent.includes('aborts when the idle period elapses between stream chunks') ||
  testContent.includes('renewable idle timeout') ||
  testContent.includes('idle timeout');

console.log('--- OpenAI Compat Stream Timeout Guard ---');
console.log(`Target Repo Root: ${rootDir}`);
console.log(`- Static Hardcoded Timeout detected: ${hasStaticTimeout ? 'YES (UNSAFE/REGRESSED)' : 'NO'}`);
console.log(`- Renewable Idle Timer implemented: ${hasRenewableIdleTimer ? 'YES' : 'NO'}`);
console.log(`- Chunk-level Reset in SSE loop: ${hasChunkReset ? 'YES' : 'NO'}`);
console.log(`- Configurable Idle Timeout Env: ${hasConfigurableIdleTimeout ? 'YES' : 'NO'}`);
console.log(`- Test Suite Coverage: ${hasIdleTimeoutTests ? 'YES' : 'NO'}`);

if (hasStaticTimeout && !hasRenewableIdleTimer) {
  console.log('\n[STATUS]: UPSTREAM_REQUIRES_PATCH (Exit code 2)');
  console.log('Result: Target codebase is using a static absolute timeout. Patch 888276d2 MUST be applied.');
  process.exit(2);
} else if (hasRenewableIdleTimer && hasChunkReset) {
  console.log('\n[STATUS]: PASS (Exit code 0)');
  console.log('Result: Renewable idle stream timeout is active and protected against stream cutoffs.');
  process.exit(0);
} else {
  console.log('\n[STATUS]: UNKNOWN_STATE (Exit code 1)');
  console.log('Result: Codebase does not match known patterns. Manual review required.');
  process.exit(1);
}
