import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { relative, resolve } from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';
import { pathToFileURL } from 'node:url';
import { generate, loadConfig } from '../dist/index.js';

const run = promisify(execFile);

test('CLI default summary reports output URLs and counts for both frameworks and config formats', async () => {
  const root = resolve('test/tmp/success-message');
  await rm(root, { recursive: true, force: true });
  await mkdir(`${root}/input`, { recursive: true });
  const document = {
    components: { schemas: {
      Task: { type: 'object', properties: { state: { type: 'string', enum: ['OPEN', 'CLOSED'] } } }
    } },
    paths: { '/tasks': { get: { operationId: 'getTasks', responses: {} } } }
  };
  for (const name of ['a', 'b']) {
    await writeFile(`${root}/input/${name}.json`, JSON.stringify(document));
  }
  const output = {
    'api-models.ts': `${root}/models #1.ts`,
    'api-endpoints.ts': `${root}/endpoints.ts`,
    'client.ts': `${root}/client.ts`
  };
  const path = `${root}/config.json`;
  const invoke = async config => {
    await writeFile(path, JSON.stringify(config));
    return run(process.execPath, ['dist/cli/index.js', 'generate', '--config', path]);
  };
  for (const client of ['angular', 'react']) {
    for (const legacy of [false, true]) {
      const config = legacy ? {
        client, 'swaggers-directory': `${root}/input`, 'enum-style': 'enum', output
      } : {
        input: `${root}/input`,
        'api-models.ts': { output: output['api-models.ts'], mergeDeclarations: true, enumStyle: 'enum' },
        'api-endpoints.ts': { output: output['api-endpoints.ts'] },
        'swagger-client.ts': { output: output['client.ts'], framework: client }
      };
      const typeCount = legacy ? 4 : 2;
      const expected = `✅ Swagger client:\n   - ${client === 'angular' ? 'Angular' : 'React'} client generated in ${pathToFileURL(output['client.ts']).href}\n   - 2 endpoints generated in ${pathToFileURL(output['api-endpoints.ts']).href}\n   - ${typeCount} types generated in ${pathToFileURL(output['api-models.ts']).href}\n`;
      assert.equal((await invoke(config)).stdout, expected);
      const models = await readFile(output['api-models.ts'], 'utf8');
      assert.equal((models.match(/^export (?:interface|type|enum) /gm) ?? []).length, typeCount);
      assert.deepEqual(await generate(await loadConfig(path)), {
        endpointCount: 2, client, typeCount,
        modelsPath: output['api-models.ts'], endpointsPath: output['api-endpoints.ts'], clientPath: output['client.ts']
      });
    }
  }
  await writeFile(`${root}/empty.json`, '{}');
  const empty = {
    input: `${root}/empty.json`,
    'api-models.ts': { output: output['api-models.ts'] },
    'api-endpoints.ts': { output: output['api-endpoints.ts'] },
    'swagger-client.ts': { output: output['client.ts'], framework: 'react' }
  };
  const emptySummary = `✅ Swagger client:\n   - React client generated in ${pathToFileURL(output['client.ts']).href}\n   - 0 endpoints generated in ${pathToFileURL(output['api-endpoints.ts']).href}\n   - 0 types generated in ${pathToFileURL(output['api-models.ts']).href}\n`;
  assert.equal((await invoke(empty)).stdout, emptySummary);
  const relativeConfig = {
    ...empty,
    'api-models.ts': { output: relative(process.cwd(), output['api-models.ts']) },
    'api-endpoints.ts': { output: relative(process.cwd(), output['api-endpoints.ts']) },
    'swagger-client.ts': { output: relative(process.cwd(), output['client.ts']), framework: 'react' }
  };
  assert.equal((await invoke(relativeConfig)).stdout, emptySummary);
  assert.deepEqual(await generate(relativeConfig), {
    endpointCount: 0, client: 'react', typeCount: 0,
    modelsPath: output['api-models.ts'], endpointsPath: output['api-endpoints.ts'], clientPath: output['client.ts']
  });
  await writeFile(`${root}/empty.json`, 'invalid JSON');
  await assert.rejects(invoke(empty), error => {
    assert.equal(error.stdout, '');
    return true;
  });
});
