import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { createBoundedMessageMethods } from './messageReads';
import { createModels } from '../models';

let mongo: MongoMemoryServer;
const scope = { user: 'read-owner', conversationId: 'read-fixture', messageId: 'message' };
const read = { ...scope, ancestry: [], position: 0, limit: 2 };
const methods = createBoundedMessageMethods(mongoose);
const privateBody = 'PRIVATE_DESCENDANT_BODY '.repeat(30_000);

async function seed(values: Record<string, unknown>) {
  await mongoose.models.Message.collection.insertOne({
    ...scope,
    createdAt: new Date('2026-10-01'),
    updatedAt: new Date('2026-10-01'),
    privateText: privateBody,
    metadata: { privateBody },
    attachments: [{ text: privateBody }],
    ...values,
  });
}

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  createModels(mongoose);
  await mongoose.connect(mongo.getUri());
});
afterAll(async () => {
  await mongoose.disconnect();
  await mongo.stop();
});
beforeEach(async () => {
  await mongoose.models.Message.deleteMany({});
});

it.each([
  { label: 'missing', value: undefined },
  { label: 'null', value: null },
  { label: 'false', value: false },
  { label: 'zero', value: 0 },
  { label: 'empty array', value: [] },
  { label: 'object with null', value: { nested: null } },
])('preserves the recorded value and omission boundary for $label', async ({ value }) => {
  await seed({
    content: [
      {
        type: 'tool_call',
        tool_call: { ...(value === undefined ? {} : { output: value }) },
      },
    ],
  });
  const row = await methods.getMessageReadContent({ ...read, field: 'output', index: 0 });
  expect(row).toMatchObject({ messageId: scope.messageId, validScope: true });
  expect(row?.recorded).toBe(value !== undefined);
  expect(row).not.toHaveProperty('stringWindow');
  if (value === undefined) expect(row).not.toHaveProperty('value');
  else expect(row).toHaveProperty('value', value);
  expect(JSON.stringify(row)).not.toContain('PRIVATE_DESCENDANT_BODY');
});

it.each([
  { text: '', position: 0, limit: 2, expected: '' },
  { text: `A中😀B${privateBody}`, position: 1, limit: 1, expected: '中😀' },
  { text: 'abc', position: 3, limit: 2, expected: '' },
  { text: 'abc', position: 1, limit: 2, expected: 'bc' },
])(
  'returns only the bounded string window at $position',
  async ({ text, position, limit, expected }) => {
    await seed({ text, content: [{ type: 'text', text: privateBody }] });
    const row = await methods.getMessageReadContent({ ...read, field: 'text', position, limit });
    expect(row).toMatchObject({ validScope: true, recorded: true, stringWindow: expected });
    expect(row).not.toHaveProperty('value');
    expect(row).not.toHaveProperty('text');
    expect(row).not.toHaveProperty('content');
    expect(Buffer.byteLength(JSON.stringify(row))).toBeLessThan(1000);
    expect(JSON.stringify(row)).not.toContain('PRIVATE_DESCENDANT_BODY');
  },
);

it.each([
  { label: 'missing', entry: undefined, recorded: false },
  { label: 'null', entry: null, recorded: false },
  { label: 'string', entry: 'invalid', recorded: false },
  { label: 'number', entry: 1, recorded: false },
  { label: 'boolean', entry: false, recorded: false },
  { label: 'array', entry: [], recorded: false },
  { label: 'empty object', entry: {}, recorded: true },
])('preserves public-entry validity and absence for $label', async ({ entry, recorded }) => {
  await seed({ content: entry === undefined ? [] : [entry] });
  const row = await methods.getMessageReadContent({ ...read, field: 'entry', index: 0 });
  expect(row).toMatchObject({ messageId: scope.messageId, validScope: true, recorded });
  if (recorded) expect(row).toHaveProperty('value', {});
  else expect(row).not.toHaveProperty('value');
  expect(row).not.toHaveProperty('stringWindow');
});

it.each([
  { label: 'missing', children: undefined },
  { label: 'null', children: null },
  { label: 'string', children: privateBody },
  { label: 'object', children: { privateBody } },
  { label: 'empty array', children: [] },
  { label: 'populated array', children: [{ type: 'text', text: privateBody }] },
])('returns only the child flag for $label descendants', async ({ children }) => {
  await seed({
    content: [
      {
        type: 'tool_call',
        privateText: privateBody,
        tool_call: {
          name: 'subagent',
          output: privateBody,
          ...(children === undefined ? {} : { subagent_content: children }),
        },
      },
    ],
  });
  const row = await methods.getMessageReadContent(read);
  expect(row?.entries).toHaveLength(1);
  if (Array.isArray(children)) expect(row?.entries?.[0]).toHaveProperty('children', true);
  else expect(row?.entries?.[0]).not.toHaveProperty('children');
  expect(row).not.toHaveProperty('content');
  expect(JSON.stringify(row)).not.toContain('PRIVATE_DESCENDANT_BODY');
  expect(JSON.stringify(row)).not.toContain('subagent_content');
  expect(Buffer.byteLength(JSON.stringify(row))).toBeLessThan(1000);
});

it('projects a valid entry before returning any private, sibling or descendant bodies', async () => {
  await seed({
    text: privateBody,
    content: [
      {
        type: 'tool_call',
        privateText: privateBody,
        text: { value: 'public', privateBody },
        tool_call: {
          id: 'call',
          args: null,
          subagent_content: [{ type: 'text', text: privateBody }],
          privateBody,
          backgroundTask: { status: 'completed', result: privateBody },
          function: { name: 'legacy', arguments: null, privateBody },
        },
      },
      { type: 'text', text: privateBody },
    ],
  });
  const row = await methods.getMessageReadContent({ ...read, field: 'entry', index: 0 });
  expect(row).toMatchObject({ validScope: true, recorded: true });
  expect(row?.value).toEqual({
    type: 'tool_call',
    text: { value: 'public' },
    tool_call: {
      id: 'call',
      args: null,
      function: { name: 'legacy', arguments: null },
      backgroundTask: { status: 'completed' },
    },
  });
  expect(row).not.toHaveProperty('text');
  expect(row).not.toHaveProperty('content');
  expect(JSON.stringify(row)).not.toContain('PRIVATE_DESCENDANT_BODY');
  expect(Buffer.byteLength(JSON.stringify(row))).toBeLessThan(1000);
});
