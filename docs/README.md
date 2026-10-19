# Documentation index

This is the entry point to this fork's in-repository ground truth. Read the relevant current
feature and maintenance guides before changing their implementation. The mandatory workflow for
every task, including repairs to existing features, is defined in
[AGENTS.md: Documentation is ground truth](../AGENTS.md#documentation-is-ground-truth).
Update the owning guide with the implementation; a task log or PR description alone is insufficient.

## Current feature and contract guides

| Area                         | Owning document                                                                  | Scope                                                                                                   |
| ---------------------------- | -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Conversation display history | [history.md](history.md)                                                         | Loading preferences, window size, paging, lazy attachment bodies, cache and full-history compatibility. |
| MCP Apps                     | [mcp-apps.md](mcp-apps.md)                                                       | Protocol integration, authenticated View operations and configuration.                                  |
| Subagent files               | [run_files.md](run_files.md)                                                     | Run-scoped file sharing, routing and attachment ownership.                                              |
| Skills management            | [skills-management-api.md](skills-management-api.md)                             | Machine-authenticated Skills routes, configuration and access contracts.                                |
| Tool approval                | [tool-approval-modes.md](tool-approval-modes.md)                                 | Agent approval modes, inherited policy and user choices.                                                |
| Conversation checkouts       | [workspace-checkouts.md](workspace-checkouts.md)                                 | Checkout selection, provisioning and compatibility during rollout.                                      |
| ACL writes                   | [permissions/acl-write-compatibility.md](permissions/acl-write-compatibility.md) | Permission update semantics, configuration and database compatibility.                                  |

## Fork maintenance and upstream merges

| Area                      | Owning document                                          | Scope                                                                                                                                           |
| ------------------------- | -------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Display-history patch     | [history-window-patch.md](history-window-patch.md)       | Rationale, actual implementation commits, source responsibilities, regressions and upstream replacement criteria.                               |
| Bounded MCP message reads | [mcp-message-reads-patch.md](mcp-message-reads-patch.md) | Companion API/MCP contracts, database projections, compatibility and upstream porting guidance.                                                 |
| Fork audit                | [fork-audit.md](fork-audit.md)                           | Dated behavior-preservation evidence and links to later patch-maintenance guides. Historical audit results are not current deployment evidence. |

When maintaining one of these areas, update its existing owner and relevant linked guides.
If an older area has no owner yet, add the minimum verified guide here; do not create a new
report for every fix. Keep the current contract readable and append dated changes only when
they explain a decision, compatibility issue, regression or upstream adaptation.

## Shared references

- [AGENTS.md](../AGENTS.md): contributor/agent requirements, module boundaries and verification rules.
- [CONTEXT.md](../CONTEXT.md): shared domain vocabulary; detailed behavior belongs to the guides above.
- [Development setup](../.devcontainer/README.md): reproducible local environment and setup boundaries.
- [Lighthouse verification](../e2e/lighthouse/README.md): performance budgets, reproduction and diagnosis.
- [PR template](../.github/pull_request_template.md): documentation paths, change explanation and verification evidence to include in review.

The guides state intended behavior and record verified implementation facts and limitations.
If code, tests, runtime observations or current requirements disagree with a guide, resolve the
discrepancy under the workflow in AGENTS.md and update the owner with the supported conclusion.
Keep planned, locally tested, CI-verified, published and deployed states distinguishable.
