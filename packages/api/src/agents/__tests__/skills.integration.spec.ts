import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { HumanMessage } from '@librechat/agents/langchain/messages';
import { createModels, createMethods } from '@librechat/data-schemas';
import { Run, Providers, FakeChatModel, SkillToolDefinition } from '@librechat/agents';
import type { Agent } from 'librechat-data-provider';
import { createToolExecuteHandler } from '../handlers';
import { injectSkillCatalog } from '../skills';

let mongo: MongoMemoryServer;
let methods: ReturnType<typeof createMethods>;
const user = new mongoose.Types.ObjectId();
const accessibleId = new mongoose.Types.ObjectId();
const inaccessibleId = new mongoose.Types.ObjectId();
const body = '# Analyze\n\nKeep this complete reference body.\nTarget: $ARGUMENTS';

beforeAll(async () => {
  mongo = await MongoMemoryServer.create({ instance: { args: ['--nounixsocket'] } });
  await mongoose.connect(mongo.getUri());
  createModels(mongoose);
  methods = createMethods(mongoose);
  await mongoose.models.Skill.create([
    {
      _id: accessibleId,
      name: 'sdk-skill',
      description: 'Analyze the requested subject with this reference.',
      body,
      author: user,
      authorName: 'Fixture user',
      version: 7,
    },
    {
      _id: inaccessibleId,
      name: 'private-skill',
      description: 'An inaccessible skill.',
      body: 'PRIVATE SKILL BODY',
      author: new mongoose.Types.ObjectId(),
      authorName: 'Other user',
    },
  ]);
}, 60000);

afterAll(async () => {
  await mongoose.disconnect();
  await mongo?.stop();
});

it.each(['sdk-skill', 'private-skill'])(
  'routes %s through the real SDK event and host access scope into the next model input',
  async (skillName) => {
    const agent: Agent = {
      id: 'skill-fixture',
      name: 'Skill fixture',
      description: 'Real SDK skill access fixture',
      created_at: 0,
      avatar: null,
      provider: 'openai',
      model: 'gpt-4o-mini',
      model_parameters: {
        temperature: null,
        maxContextTokens: null,
        max_context_tokens: null,
        max_output_tokens: null,
        top_p: null,
        frequency_penalty: null,
        presence_penalty: null,
      },
    };
    const catalog = await injectSkillCatalog({
      agent,
      accessibleSkillIds: [accessibleId],
      contextWindowTokens: 200_000,
      listSkillsByAccess: methods.listSkillsByAccess,
      toolDefinitions: undefined,
      toolRegistry: undefined,
      userId: user.toString(),
    });
    expect(agent.additional_instructions).toContain('sdk-skill');
    expect(agent.additional_instructions).not.toContain('private-skill');
    expect(catalog.toolDefinitions).toContainEqual(SkillToolDefinition);
    const getSkillByName = jest.fn(methods.getSkillByName);
    const handler = createToolExecuteHandler({
      loadTools: async () => ({ loadedTools: [] }),
      getSkillByName,
    });
    const execute = jest.spyOn(handler, 'handle');
    const llmConfig = {
      provider: Providers.OPENAI,
      model: 'gpt-4o-mini',
      apiKey: 'fixture-key',
      streaming: true,
      streamUsage: false,
    };
    const run = await Run.create({
      runId: `skill-${skillName}`,
      graphConfig: {
        type: 'standard',
        llmConfig,
        agents: [
          {
            agentId: agent.id,
            provider: Providers.OPENAI,
            clientOptions: llmConfig,
            instructions: agent.additional_instructions ?? undefined,
            tools: [],
            toolDefinitions: catalog.toolDefinitions,
          },
        ],
      },
      customHandlers: { on_tool_execute: handler },
      returnContent: true,
      tokenCounter: (text) => String(text ?? '').length,
      indexTokenCountMap: {},
    });
    if (!run.Graph) throw new Error('The test run did not initialize its graph.');
    const model = new FakeChatModel({
      responses: ['Load the skill.', 'Done.'],
      toolCalls: [
        { name: SkillToolDefinition.name, args: { skillName, args: 'fixture' }, id: 'skill-call' },
      ],
    });
    const modelInput = jest.spyOn(model, '_streamResponseChunks');
    run.Graph.overrideModel = model;
    await run.processStream(
      { messages: [new HumanMessage('Analyze the fixture.')] },
      {
        configurable: { thread_id: skillName, accessibleSkillIds: catalog.activeSkillIds },
        version: 'v2',
      },
    );
    expect(execute).toHaveBeenCalledTimes(1);
    expect(getSkillByName).toHaveBeenCalledWith(skillName, [accessibleId], {
      preferModelInvocable: true,
    });
    expect(modelInput).toHaveBeenCalledTimes(2);
    const messages = modelInput.mock.calls[1][0];
    expect(JSON.stringify(messages)).not.toContain('PRIVATE SKILL BODY');
    const carriers = messages.filter((message) =>
      message.content.toString().includes('[Skill source'),
    );
    if (skillName === 'private-skill') {
      expect(carriers).toHaveLength(0);
      expect(
        messages.some((message) => message.content.toString().includes('not accessible')),
      ).toBe(true);
      return;
    }
    expect(carriers).toHaveLength(1);
    expect(carriers[0].getType()).toBe('human');
    expect(carriers[0].content).toContain(
      `[Skill source {"name":"sdk-skill","id":"${accessibleId}","version":7}]`,
    );
    expect(carriers[0].content).toContain(body.replace('$ARGUMENTS', 'fixture'));
    expect(carriers[0].content).toContain('[End skill source]');
  },
);
