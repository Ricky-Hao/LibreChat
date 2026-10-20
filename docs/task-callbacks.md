# External task callbacks

`create_task_callback` is a built-in Agent tool for an executor that works outside
LibreChat. It registers one terminal result in the current ordinary Agent
conversation. It does not spawn a child Agent, accept routing arguments, or stop
the current generation.

Enable `task_callbacks` in `endpoints.agents.capabilities`, configure the feature,
and attach **External Task Callback** from the Agent builder's built-in tools.
The tool remains an `agent.tools` entry named `create_task_callback`. It is
Agents-only and requires no Workspace/Remote Agents API key. Existing child
bindings, fire/steer events, and ordinary background tools keep their contracts.

```yaml
endpoints:
  agents:
    # Preserve the other capabilities your deployment needs.
    capabilities: [tools, task_callbacks]
    taskCallbacks:
      enabled: true
      publicUrl: https://chat.example/api/agents/task-callbacks
```

The feature defaults **off**, and its capability is not added to the default
capability list. `publicUrl` must be the exact webhook endpoint, use HTTPS
(loopback HTTP is accepted for fixtures), and contain no credentials, query, or
fragment. It is an administrator-owned setting, never a model argument.

The empty-input tool captures the authenticated owner/tenant, resolved Agent,
runtime conversation, assistant message anchor, and tool-call identity. It returns
`callback_id`, `callback_url`, `expires_at`, `max_output_bytes`, and guidance:
submit the task, confirm acceptance, then give a brief final response if no
independent work remains. Do not poll. Registration alone does not end the turn;
a terminal callback starts a later generation in the original conversation.

The model intentionally receives the random 256-bit `tcb_…` bearer and forwards
it to the executor through Coder as private callback input. Do not place it in
the executor's OpenCode prompt, argv, environment, URLs, status, logs, or normal
user prose. This is not an opaque secret-injection service. The module adapter
accepts the registration JSON on stdin or from a private file. Deliberate tool
traffic and the model's retained tool context necessarily carry the registration;
treat conversation and checkpoint access as sensitive. Application logs redact
the bearer prefix, callback tool output is excluded from Langfuse observations,
and Markdown/message copying masks callback IDs, including partial streamed IDs.
Never use a resolved tool-traffic dump as a diagnostic credential check.

## Terminal protocol

`POST /api/agents/task-callbacks`, `Content-Type: application/json`:

```json
{
  "version": 1,
  "callback_id": "<private callback_id from the tool>",
  "status": "success",
  "output": "Bounded final assistant output"
}
```

`status` is exactly `success`, `error`, or `cancelled`. All other properties are
rejected, including `input`, `prompt`, `target`, `mode`, and metadata. There is no
Authorization header, callback status URL, producer heartbeat, or task dashboard.
The bearer is accepted only in the JSON body. Output is bounded by UTF-8 bytes,
not just JavaScript character count. Callback IDs echoed into result data are
masked before persistence; the retry digest still covers the original submission.

The first terminal result atomically seals its digest, result, acceptance time,
stable receipt ID, and pending publication flag. Only then does the route return
`202` with `{version:1,receipt_id,accepted_at}`. The pending flag is the durable,
recoverable queue handoff. A lost reply can be retried: identical submissions
return the same receipt; a different status or output returns `409`. A first
submission after expiry returns `410`, unknown/deleted callbacks return `404`,
invalid bodies return `400`, rate limiting returns `429`, and storage outages
return safe `503` with `Retry-After`. Sealed retries remain replayable during
receipt retention, even after registration expiry. `202` acknowledges storage
and recoverable delivery, not completed model inference.

## Storage, recovery, and continuation

[callbacks.ts](../packages/api/src/agents/callbacks.ts) owns the tool, ingress,
outbox publisher, and continuation resolver.
[callbackDefinition.ts](../packages/api/src/agents/callbackDefinition.ts) supplies
the dependency-free built-in catalog schema and delivery guidance.
[taskCallback.ts](../packages/data-schemas/src/methods/taskCallback.ts) owns the
Mongo model and database operations. The callback collection stores a SHA-256
bearer hash and encrypted registration replay value, with unique registration
and receipt indexes. Replaying the same trusted tool-call identity returns the
same bearer; it does not mint another task. Encryption uses the deployment's
existing credentials encryption adapter/key. Do not rotate it without the usual
retained-data key plan.

Every replica periodically scans pending publications, and local acceptance wakes
the scanner. Publication uses a stable delivery identity and the existing Mongo
trigger queue. A crash before publication or after publication but before saving
its receipt is repaired by replaying that identity. Envelopes contain only an
opaque receipt ID, owner/tenant and original target; they contain no bearer or
terminal output. `task_callback_v1` capability fencing prevents an older worker
from interpreting this source. No external producer lease is required.

Before dispatch, the resolver reads the durable result and validates expiry,
owner-scoped conversation, exact tenant/Agent, retention, and original assistant
anchor. Running, approval-paused, or terminal-persistence-pending generations
defer without consuming attempts. This also handles a callback arriving before
the parent conversation/message is saved. Once settled, only a single complete
path below the original anchor may advance the branch. Forks, cycles, missing
rows, expired rows, a dangling user turn, and a history scan exceeding its bound
fail closed. An unrelated globally newest message is never selected.

The selected parent is durably frozen before transport. Lost admission replies
retry that parent and the queue's stable client request ID. Each retry still
validates anchor lineage and retention. The existing host's `settleOnAdmission`
hook saves a durable source admission marker before the delivery queue completes;
recovery of a lost queue finalization then settles without another generation.
The ordinary authenticated Agent chat
admission path revalidates the live user, tenant, role and Agent ACL and prevents
replacement of a busy parent. Its existing durable generation claim deduplicates
ambiguous retries. No public child binding or fire route is involved.
As with other internal continuations, recovery of an in-flight generation's lost
transport reply depends on the configured generation store; use Redis for
restart/replica recovery. Mongo independently retains terminal callbacks, source
admission markers, and queue state. These receipts do not establish exactly-once
model execution after loss of a volatile generation store.

Conversation deletion and committed account deletion purge private callback
records through the existing deletion hooks. A deleted record settles its queued
wakeup without generating. If the conversation disappears between checks, the
ordinary chat admission guard still rejects the missing parent. Dead deliveries
remain available to the existing trusted trigger maintenance API; there is no
new public requeue surface.

## Configuration and limits

All fields are under `endpoints.agents.taskCallbacks` in
[taskCallbacks.ts](../packages/data-provider/src/taskCallbacks.ts).

| Field                | Default   | Bounds / meaning                                        |
| -------------------- | --------- | ------------------------------------------------------- |
| `enabled`            | `false`   | Ingress and continuation feature gate                   |
| `publicUrl`          | Unset     | Exact public callback endpoint                          |
| `ttlMs`              | 86400000  | 60000–604800000; result must be delivered before expiry |
| `receiptRetentionMs` | 604800000 | 86400000–7776000000 after registration expiry           |
| `maxOutputBytes`     | 32768     | 1–32768 UTF-8 bytes; returned to the adapter            |
| `requestsPerMinute`  | 60        | 1–10000 per source IP per replica                       |
| `recoveryIntervalMs` | 30000     | 1000–300000; durable outbox scan cadence                |
| `recoveryBatchSize`  | 25        | 1–1000 per scan                                         |
| `branchMessageLimit` | 2000      | 10–10000; larger histories fail closed                  |

The ingress rate limiter uses the app's proxy/IP trust configuration and an
in-process store. Replicas each enforce the configured budget; an ingress gateway
may additionally enforce a fleet-wide limit. Mongo TTL is cleanup, not admission
authorization: explicit time checks apply even before the TTL monitor deletes a row.

## Verification and rollout

Run the owning fixtures without paid model calls:

```sh
# From packages/api; companion module checkout is required for the cross-repo case.
CODER_MODULES_CHECKOUT=/workspaces/coder-modules npx jest src/agents/callbacks.integration.spec.ts --runInBand
# From packages/data-provider
npx jest src/taskCallbacks.spec.ts --runInBand
```

The integration fixture exercises the actual tool, HTTP handler, Mongo callback
and trigger records, continuation resolver and host admission transport. It
covers concurrent duplicates/conflict, lost receipts, fast/busy/approval parents,
branch isolation, deletion/retention/expiry, bounded bodies and crash recovery.
The companion module's actual `TaskRunner` posts into that handler. Its model and
the host's inference response are local fixtures; a mocked `403` verifies the
queue's ACL-denial handling, while existing chat admission suites cover the live
authorization middleware. This is source/local validation, not deployment evidence.

Deploy reviewed matching server/client packages and the module bundle, ensure
Mongo indexes and existing credentials encryption are healthy, configure the
public HTTPS endpoint and capability, use Redis generation storage for in-flight
restart/replica recovery, then attach the built-in to the intended
Agent. Use a callback-capable fleet before enabling producers; do not downgrade
while its pending callback deliveries remain. Live Agent/Skill configuration,
publication, deployments and production webhooks are separate operator actions.
