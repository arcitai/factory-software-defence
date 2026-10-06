// Reads native Claude history through the official read-only SDK utilities.
// The launcher runs this file with only the selected profile's environment,
// so the SDK resolves CLAUDE_CONFIG_DIR without touching the bridge process.
import { getSessionInfo, getSessionMessages } from '@anthropic-ai/claude-agent-sdk';
import { fileURLToPath } from 'node:url';

// Native interruption notices also have role=user. Match the confirmed input
// UUID, and anchor the terminal receipt to the native history's final UUID.
export function projectHistory(info, messages, input) {
  const matches=messages.filter(entry=>entry.uuid===input);
  const message=matches.length===1 && matches[0].type==='user' ? matches[0] : null;
  return {
    session: info ? { id: info.sessionId, cwd: info.cwd ?? null } : null,
    input: message ? { uuid:message.uuid, session_id:message.session_id } : null,
    tip_uuid: messages.at(-1)?.uuid ?? null,
  };
}
if (process.argv[1]===fileURLToPath(import.meta.url)) {
  const { session, dir, input }=JSON.parse(process.argv[2]);
  const info=await getSessionInfo(session,{dir});
  const messages=info ? await getSessionMessages(session,{dir}) : [];
  process.stdout.write(JSON.stringify(projectHistory(info,messages,input)));
}
