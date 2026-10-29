import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { test } from 'node:test';
import Ajv from 'ajv';
import { loadConfig, validateConfig } from '../dist/core/load-config.js';

const schema = JSON.parse(await readFile(new URL('../schema.json', import.meta.url), 'utf8'));
const validate = new Ajv({ strict: false, allErrors: true }).compile(schema);
const grouped = () => ({
  input: ['swaggers/**/*.json', '!swaggers/private/**'],
  'api-models.ts': { output: 'generated/models.ts' },
  'api-endpoints.ts': { output: 'generated/endpoints.ts' },
  'swagger-client.ts': { output: 'generated/client.ts', framework: 'angular' }
});
const legacy = () => ({ client: 'react', 'swaggers-directory': 'swaggers', output: {
  'api-models.ts': 'models.ts', 'api-endpoints.ts': 'endpoints.ts', 'client.ts': 'client.ts'
} });
function check(config, expected) {
  assert.equal(validate(config), expected, JSON.stringify(validate.errors));
  if (expected) assert.doesNotThrow(() => validateConfig(config, 'test'));
  else assert.throws(() => validateConfig(config, 'test'));
}

test('schema and CLI accept both formats and all current options', () => {
  check(grouped(), true);
  check(legacy(), true);
  for (const framework of ['angular', 'react']) {
    const config = grouped();
    config.$schema = './node_modules/@let-aurn/swagger-client/schema.json';
    config.namespace = { pointer: '/info/x~1namespace', pattern: '^([^/]+)' };
    config['api-models.ts'] = { output: 'models.ts', enumStyle: 'enum', mergeDeclarations: true, prefix: '${namespace}_' };
    config['api-endpoints.ts'] = { output: 'endpoints.ts', naming: 'namespace_tag_operationId', serverIndex: 0 };
    config['swagger-client.ts'].framework = framework;
    check(config, true);
  }
  check({ ...legacy(), $schema: 'https://example.com/schema.json', 'endpoint-namespace': { pointer: '' }, 'endpoint-name-strategy': 'namespaceTagAndOperationId', mergeDeclarations: true, 'enum-style': 'union', serverUrlIndex: 9007199254740991 }, true);
  for (const input of ['swaggers', '!(private)/**/*.json', ['!private/**', '!(private)/**/*.json']]) check({ ...grouped(), input }, true);
  check({ ...grouped(), 'api-models.ts': { output: 'models.ts', prefix: '' } }, true);
  check({ ...grouped(), 'api-models.ts': { output: 'models.ts', mergeDeclarations: true } }, true);
});

test('schema and CLI reject invalid options and missing dependencies', () => {
  for (const value of [null, [], {}, { ...grouped(), $schema: 4 }, { ...grouped(), $schema: ' ' }, { ...legacy(), $schema: false }, { ...grouped(), client: 'react' }, { ...grouped(), typo: true }]) check(value, false);
  for (const input of ['', ' ', '!', '!private/**', [], ['!private/**'], ['ok', 1]]) check({ ...grouped(), input }, false);
  for (const framework of ['fetch', 'Angular', null]) check({ ...grouped(), 'swagger-client.ts': { output: 'client.ts', framework } }, false);
  for (const output of ['', ' ', 1, null]) check({ ...grouped(), 'api-models.ts': { output } }, false);
  for (const prefix of ['1Bad', 'bad-', '${other}', '${namespace}_']) check({ ...grouped(), 'api-models.ts': { output: 'models.ts', prefix } }, false);
  for (const naming of ['namespace_operationId', 'namespace_tag_operationId', 'wrong']) check({ ...grouped(), 'api-endpoints.ts': { output: 'endpoints.ts', naming } }, false);
  for (const serverIndex of [-1, 0.5, 9007199254740992, '0']) check({ ...grouped(), 'api-endpoints.ts': { output: 'endpoints.ts', serverIndex } }, false);
  for (const namespace of [{}, { pointer: 'invalid' }, { pointer: '/~2' }, { pointer: '/', pattern: 1 }]) check({ ...grouped(), namespace }, false);
  check({ ...grouped(), 'api-models.ts': { output: 'models.ts', enumStyle: 'wrong' } }, false);
  check({ ...grouped(), 'api-models.ts': { output: 'models.ts', mergeDeclarations: 'true' } }, false);
  check({ ...grouped(), 'api-endpoints.ts': { output: 'endpoints.ts', typo: 1 } }, false);
  check({ ...legacy(), mergeDeclarations: true }, false);
  check({ ...legacy(), 'endpoint-name-strategy': 'namespaceTagAndOperationId' }, false);
});

test('repository config validates and $schema does not affect path resolution', async () => {
  const config = JSON.parse(await readFile(new URL('../swagger-client.json', import.meta.url), 'utf8'));
  check(config, true);
  await mkdir('test/tmp/config-schema', { recursive: true });
  const file = 'test/tmp/config-schema/config.json';
  for (const source of [grouped(), legacy()]) {
    await writeFile(file, JSON.stringify(source));
    const without = await loadConfig(file);
    await writeFile(file, JSON.stringify({ ...source, $schema: 'https://unreachable.invalid/schema.json' }));
    const { $schema, ...withSchema } = await loadConfig(file);
    assert.deepEqual(withSchema, without);
  }
});

test('npm package includes the schema', async () => {
  const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  assert.ok(pkg.files.includes('schema.json'));
});
