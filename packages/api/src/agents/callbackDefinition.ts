export const TASK_CALLBACK_SOURCE = 'external-task-callback';
export const TASK_CALLBACK_TOOL = 'create_task_callback';
export const TASK_CALLBACK_GUIDANCE =
  'Submit the external task with this callback, confirm the executor accepted it, then if no independent work remains output a brief final response. Registration alone does not end generation. Do not poll. A terminal callback automatically starts a subsequent generation in this conversation. Keep the callback_id out of normal user prose, logs, URLs, and prompts to the executor; forward it only as private callback input.';
export const TaskCallbackToolDefinition: {
  name: string;
  description: string;
  schema: { type: 'object'; properties: Record<string, never>; additionalProperties: false };
} = {
  name: TASK_CALLBACK_TOOL,
  description: `Register one terminal external-task callback bound to this ordinary conversation and Agent. Not supported in child Agent executions or subagent threads. ${TASK_CALLBACK_GUIDANCE}`,
  schema: { type: 'object', properties: {}, additionalProperties: false },
};
