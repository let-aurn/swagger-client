import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';
import { generate, readOpenApiProject } from '../dist/index.js';

test('documents operation descriptions and marks deprecated endpoint declarations', async () => {
  const root = resolve('test/tmp/deprecated-endpoints');
  await rm(root, { recursive: true, force: true });
  await mkdir(`${root}/input`, { recursive: true });
  const input = `${root}/input/pets.json`;
  for (const legacy of [false, true]) {
    await writeFile(input, JSON.stringify({
      ...(legacy ? { swagger: '2.0' } : { openapi: '3.0.1' }),
      ...(legacy
        ? { definitions: { Pet: { type: 'object', properties: { name: { type: 'string' } } } } }
        : { components: { schemas: { Pet: { type: 'object', properties: { name: { type: 'string' } } } } } }),
      paths: {
        '/pets/legacy': { post: { operationId: 'createLegacyPet', deprecated: true, description: 'Use createPet instead.' } },
        '/pets': { post: { operationId: 'createPet', deprecated: false, description: 'Creates a **pet**.\r\n\r\nAccepts names containing */ characters.' } },
        '/pets/{id}': { get: { operationId: 'getPet' } }
      }
    }));
    const project = legacy
      ? await readOpenApiProject(input)
      : await readOpenApiProject(input, {});
    assert.deepEqual(project.endpoints.map(({ name, deprecated }) => ({ name, deprecated })), [
      { name: 'createLegacyPet', deprecated: true },
      { name: 'createPet', deprecated: false },
      { name: 'getPet', deprecated: false }
    ]);
    assert.equal(project.endpoints[0].description, 'Use createPet instead.');
    assert.equal(project.endpoints[1].description, 'Creates a **pet**.\r\n\r\nAccepts names containing */ characters.');
    assert.equal(project.endpoints[2].description, undefined);
    for (const client of ['angular', 'react']) {
      const output = {
        'api-models.ts': `${root}/models.ts`,
        'api-endpoints.ts': `${root}/endpoints.ts`,
        'client.ts': `${root}/client.ts`
      };
      const config = legacy ? { client, 'swaggers-directory': input, output } : {
        input,
        'api-models.ts': { output: output['api-models.ts'] },
        'api-endpoints.ts': { output: output['api-endpoints.ts'] },
        'swagger-client.ts': { output: output['client.ts'], framework: client }
      };
      const result = await generate(config);
      assert.equal(result.endpointCount, 3);
      const endpoints = await readFile(output['api-endpoints.ts'], 'utf8');
      assert.match(endpoints, /\/\*\*\n   \* POST - \/pets\/legacy\n   \*\n   \* Use createPet instead\.\n   \*\n   \* @deprecated\n   \*\/\n  export const createLegacyPet/);
      assert.ok(endpoints.includes('   * POST - /pets\n   *\n   * Creates a **pet**.\n   *\n   * Accepts names containing *\\/ characters.\n   */\n  export const createPet'));
      assert.match(endpoints, /\/\*\*\n   \* GET - \/pets\/\{id\}\n   \*\/\n  export const getPet/);
      assert.equal((endpoints.match(/@deprecated/g) ?? []).length, 1);
      assert.equal((endpoints.match(/deprecated: true/g) ?? []).length, 1);
      assert.match(endpoints, /readonly deprecated\?: boolean/);
    }
    await promisify(execFile)('npx', ['tsc', '--ignoreConfig', `${root}/models.ts`, `${root}/endpoints.ts`,
      '--noEmit', '--strict', '--skipLibCheck', '--target', 'ES2022', '--module', 'ESNext', '--moduleResolution', 'Bundler']);
  }
});
