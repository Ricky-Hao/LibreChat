import { Types } from 'mongoose';
import { HumanMessage } from '@librechat/agents/langchain/messages';
import { convertInjectedMessages, projectMessageStructure } from '@librechat/agents';
import {
  buildAgentEventActorSkillMessages,
  buildSkillPrimeMessage,
  injectSkillPrimes,
} from './skills';
import {
  dropUnusableSummaryParts,
  findPreviousSummary,
  resolveCheckpointMessage,
} from './compaction';

describe('context provenance offline fixtures', () => {
  const skill = {
    _id: new Types.ObjectId('000000000000000000000001'),
    name: 'fixture',
    body: 'SECRET_CANARY_BODY',
    version: 3,
  };

  it('preserves source identity in model, manual, always-apply and actor skill paths', () => {
    const model = convertInjectedMessages([buildSkillPrimeMessage(skill)]);
    const manual = [new HumanMessage('question')];
    injectSkillPrimes({
      initialMessages: manual,
      indexTokenCountMap: undefined,
      manualSkillPrimes: [skill],
      alwaysApplySkillPrimes: [skill],
    });
    const always = [new HumanMessage('question')];
    injectSkillPrimes({
      initialMessages: always,
      indexTokenCountMap: undefined,
      alwaysApplySkillPrimes: [skill],
    });
    const actor = buildAgentEventActorSkillMessages(new Map([[skill.name, skill.body]]), [skill]);
    expect(manual).toHaveLength(2);
    for (const message of [model[0], manual[0], always[0], actor[0]]) {
      expect(message.getType()).toBe('human');
      expect(message.content).toContain(skill.body);
      expect(message.content).toContain(`"id":"${skill._id.toString()}"`);
      expect(message.content).toContain('"version":3');
      expect(String(message.content).match(/Skill source/g)).toHaveLength(1);
      expect(JSON.stringify(projectMessageStructure([message]))).not.toContain('SECRET_CANARY');
    }
  });

  it('keeps early history selection and replay aligned on diagnostic stubs', () => {
    const summary = '[Metadata summary: 2 messages (1 human, 1 ai)]';
    const prior = { summary: 'Valid prior checkpoint', tokenCount: 12 };
    const invalid = { summary, tokenCount: 1 };
    expect(findPreviousSummary([prior, invalid])).toBe(prior);
    expect(resolveCheckpointMessage(invalid)).toBeNull();
    const parts = [
      {
        type: 'summary' as const,
        content: [{ type: 'text' as const, text: summary }],
        boundary: { messageId: 'step', contentIndex: 0 },
      },
    ];
    const message = { content: parts };
    expect(dropUnusableSummaryParts(message)).toBe(true);
    expect(message.content).toEqual([]);
  });
});
