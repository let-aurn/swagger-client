import assert from 'node:assert/strict';
import test from 'node:test';
import { schemaToType } from '../dist/core/schema-to-typescript.js';

test('arrays preserve the complete item type', () => {
  const cases = [
    [{ oneOf: [{ type: 'string' }, { type: 'number' }] }, 'Array<string | number>'],
    [{ anyOf: [{ type: 'string' }, { type: 'boolean' }] }, 'Array<string | boolean>'],
    [{ enum: ['pending', 'done'] }, 'Array<"pending" | "done">'],
    [{ type: 'string', nullable: true }, 'Array<string | null>'],
    [{ allOf: [{ $ref: '#/components/schemas/A' }, { $ref: '#/components/schemas/B' }] }, 'Array<A & B>'],
    [{ type: 'array', items: { oneOf: [{ type: 'string' }, { type: 'number' }] } }, 'Array<Array<string | number>>'],
    [undefined, 'Array<unknown>']
  ];

  for (const [items, expected] of cases) {
    assert.equal(schemaToType({ type: 'array', items }), expected);
  }
});

test('nullable arrays keep null outside the array item type', () => {
  assert.equal(
    schemaToType({ type: 'array', nullable: true, items: { type: 'string' } }),
    'Array<string> | null'
  );
});
