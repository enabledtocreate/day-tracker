# AI API — JSON Schema

JSON Schema files for Smart Planning / chat responses live in this folder.

**Normative narrative:** [`docs/Application-Spec.md`](../../docs/Application-Spec.md) §4.8 and §5.2.  
**Types (client):** [`lib/aiTypes.ts`](../../lib/aiTypes.ts).

| File | Describes |
|------|-----------|
| `assistant-response.schema.json` | Normalized assistant JSON envelope (chat response body) |
| `chat-request.schema.json` | POST body for `api/chat.php` (message, viewDate, taskContext, …) |
| `task-context.schema.json` | **`taskContext`** payload sent to the AI agent (tasks, slots, org, optional iCal) |

**`taskContext`** is built in `components/AIPanel.tsx` (`buildTaskContext`) and on the server in `lib/ai_server_context.php` when `useServerContext` is set. Types: `lib/aiTypes.ts` (`AiChatRequestBody.taskContext`). Narrative: `docs/Application-Spec.md` §4.8 and `docs/AI_ENVIRONMENT.md`.

Additional request/response schemas may be added as endpoints stabilize.
