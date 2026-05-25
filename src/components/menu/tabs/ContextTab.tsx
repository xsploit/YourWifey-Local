import type { Dispatch, SetStateAction } from 'react';
import type { GrilloMemoryState } from '../../../lib/chat/grillo-memory';
import type { AiSettings, RelationshipMemory } from '../../../lib/chat/types';

type ContextTabProps = {
  aiSettings: AiSettings;
  availableModels: string[];
  chatDraftLength: number;
  messageCount: number;
  onClearChat: () => void;
  onClearDraft: () => void;
  onClearMemory: () => void;
  onRefreshModels: () => void;
  onResetContext: () => void;
  onRunMemoryAgent: () => void;
  grilloMemoryState: GrilloMemoryState;
  relationshipMemory: RelationshipMemory;
  memoryAgentBusy: boolean;
  memoryAgentStatus: string;
  modelsError: string | null;
  modelsLoading: boolean;
  setAiSettings: Dispatch<SetStateAction<AiSettings>>;
};

export function ContextTab({
  aiSettings,
  availableModels,
  chatDraftLength,
  messageCount,
  onClearChat,
  onClearDraft,
  onClearMemory,
  onRefreshModels,
  onResetContext,
  onRunMemoryAgent,
  grilloMemoryState,
  relationshipMemory,
  memoryAgentBusy,
  memoryAgentStatus,
  modelsError,
  modelsLoading,
  setAiSettings,
}: ContextTabProps) {
  const recentBlocks = [...grilloMemoryState.blocks].reverse().slice(0, 6);
  const recentCandidates = [...grilloMemoryState.candidates].reverse().slice(0, 8);
  const recentDiary = [...grilloMemoryState.diaryEntries].reverse().slice(0, 4);
  const promotedCount = grilloMemoryState.promotedCandidateIds.length;
  const hasGrilloMemory =
    grilloMemoryState.blocks.length > 0 ||
    grilloMemoryState.candidates.length > 0 ||
    grilloMemoryState.diaryEntries.length > 0;
  const lastUpdated =
    hasGrilloMemory && grilloMemoryState.updatedAt > 0
      ? new Date(grilloMemoryState.updatedAt).toLocaleString()
      : '';

  return (
    <>
      <div className="control-group">
        <div className="control-label">Memory Worker</div>
        <select
          className="select-tech"
          onChange={(event) =>
            setAiSettings((current) => ({
              ...current,
              memoryAgentModel: event.target.value,
            }))
          }
          value={aiSettings.memoryAgentModel}
        >
          <option value="">Auto (preferred cheap model)</option>
          {availableModels.map((model) => (
            <option key={model} value={model}>
              {model}
            </option>
          ))}
        </select>
        <button className="btn-tech secondary" onClick={onRefreshModels} type="button">
          {modelsLoading ? 'Refreshing...' : 'Refresh Models'}
        </button>
        <div className="field-hint">
          Controls the background memory worker. It writes durable memories, reflective diary
          thoughts, and the relationship profile used in future replies.
        </div>
        <label className="setting-row">
          <span>Auto-run every N chat messages</span>
          <input
            className="input-tech compact-input"
            max={100}
            min={1}
            onChange={(event) => {
              const next = Number(event.target.value);
              if (Number.isFinite(next)) {
                setAiSettings((current) => ({
                  ...current,
                  memoryAgentIntervalMessages: Math.max(1, Math.min(100, Math.round(next))),
                }));
              }
            }}
            type="number"
            value={aiSettings.memoryAgentIntervalMessages}
          />
        </label>
        <div className="field-hint">
          Counts normalized local chat and Twitch chat messages. The worker runs from the same queue
          as the manual button after this many messages land in the current memory scope.
        </div>
        <div className="btn-row">
          <button
            className="btn-tech secondary"
            disabled={memoryAgentBusy}
            onClick={onRunMemoryAgent}
            type="button"
          >
            {memoryAgentBusy ? 'Running...' : 'Run Memory Worker'}
          </button>
        </div>
        <div className="status-copy">{memoryAgentStatus}</div>
        {modelsError ? <div className="status-copy">{modelsError}</div> : null}
      </div>

      <div className="control-group">
        <div className="control-label">Memory Store</div>
        <div className="memory-kv-grid">
          <div className="status-copy">
            Scope: <strong>{grilloMemoryState.scopeKey}</strong>
          </div>
          <div className="status-copy">
            Blocks: <strong>{grilloMemoryState.blocks.length}</strong>
          </div>
          <div className="status-copy">
            Candidates: <strong>{grilloMemoryState.candidates.length}</strong>
          </div>
          <div className="status-copy">
            Diary entries: <strong>{grilloMemoryState.diaryEntries.length}</strong>
          </div>
          <div className="status-copy">
            Promoted: <strong>{promotedCount}</strong>
          </div>
          <div className="status-copy">
            Updated: <strong>{lastUpdated || 'not yet'}</strong>
          </div>
        </div>
        <div className="field-hint">
          This is the current persona/source memory scope. Twitch and local chat can have different
          stores. Candidate memories ingest raw local and Twitch chat turns; diary thoughts are
          written by the worker only when there is something worth reflecting on.
        </div>
      </div>

      <div className="control-group">
        <div className="control-label">Memory Blocks</div>
        {recentBlocks.length > 0 ? (
          <div className="memory-list">
            {recentBlocks.map((block) => (
              <div className="memory-entry" key={block.blockId}>
                <div className="memory-entry-header">
                  <strong>{block.blockName}</strong>
                  <span>{block.participantKey}</span>
                </div>
                <ul>
                  {block.items.slice(-4).map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        ) : (
          <div className="status-copy">No promoted memory blocks yet.</div>
        )}
      </div>

      <div className="control-group">
        <div className="control-label">Recent Candidates</div>
        {recentCandidates.length > 0 ? (
          <div className="memory-list">
            {recentCandidates.map((candidate) => (
              <div className="memory-entry" key={candidate.candidateId}>
                <div className="memory-entry-header">
                  <strong>{candidate.type}</strong>
                  <span>{Math.round(candidate.confidence * 100)}%</span>
                </div>
                <div className="status-copy">{candidate.summary}</div>
                <div className="memory-pill-row">
                  <span className="memory-pill">{candidate.source}</span>
                  <span className="memory-pill">{candidate.participantKey}</span>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="status-copy">No candidate memories captured yet.</div>
        )}
      </div>

      <div className="control-group">
        <div className="control-label">Reflective Diary</div>
        {recentDiary.length > 0 ? (
          <div className="memory-list">
            {recentDiary.map((entry) => (
              <div className="memory-entry" key={entry.diaryId}>
                <div className="memory-entry-header">
                  <strong>{entry.beatType}</strong>
                  <span>{new Date(entry.createdAt).toLocaleString()}</span>
                </div>
                <div className="status-copy">{entry.summary}</div>
                {entry.interactionSummary ? (
                  <div className="status-copy">{entry.interactionSummary}</div>
                ) : null}
                <pre className="context-preview compact">{entry.personalThought}</pre>
                {entry.emotions?.length || entry.contextTags?.length ? (
                  <div className="memory-pill-row">
                    {entry.emotions?.map((emotion) => (
                      <span className="memory-pill" key={`${entry.diaryId}:${emotion.name}`}>
                        {emotion.name} {Math.round(emotion.intensity)}/10
                      </span>
                    ))}
                    {entry.contextTags?.map((tag) => (
                      <span className="memory-pill" key={`${entry.diaryId}:${tag}`}>
                        {tag}
                      </span>
                    ))}
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        ) : (
          <div className="status-copy">No reflective diary thoughts yet.</div>
        )}
      </div>

      <div className="control-group">
        <div className="control-label">Relationship Profile</div>
        <div className="status-copy">
          Messages: <strong>{messageCount}</strong>
        </div>
        <div className="status-copy">
          Draft chars: <strong>{chatDraftLength}</strong>
        </div>
        <div className="status-copy">
          Relationship stage: <strong>{relationshipMemory.relationshipStage}</strong>
        </div>
        <div className="status-copy">
          Mood: <strong>{relationshipMemory.mood}</strong>
        </div>
        <div className="status-copy">
          Stored facts: <strong>{relationshipMemory.facts.length}</strong>
        </div>
        <div className="status-copy">
          Prior turns: <strong>{relationshipMemory.turnCount}</strong>
        </div>
        <div className="status-copy">
          Last worker pass: <strong>{relationshipMemory.lastDiaryTurnCount}</strong>
        </div>
      </div>

      <div className="control-group">
        <div className="control-label">Relationship Stats</div>
        <div className="status-copy">
          Trust: <strong>{relationshipMemory.trust}</strong>
        </div>
        <div className="status-copy">
          Attraction: <strong>{relationshipMemory.attraction}</strong>
        </div>
        <div className="status-copy">
          Respect: <strong>{relationshipMemory.respect}</strong>
        </div>
        <div className="status-copy">
          Irritation: <strong>{relationshipMemory.irritation}</strong>
        </div>
        <div className="status-copy">
          Jealousy: <strong>{relationshipMemory.jealousy}</strong>
        </div>
        <div className="status-copy">
          Guard: <strong>{relationshipMemory.guard}</strong>
        </div>
        <div className="status-copy">
          Last action tag: <strong>{relationshipMemory.lastActionTag}</strong>
        </div>
      </div>

      <div className="control-group">
        <div className="control-label">Profile Summary</div>
        <pre className="context-preview">
          {relationshipMemory.summary
            ? relationshipMemory.summary
            : 'No stored relationship summary yet.'}
        </pre>
      </div>

      <div className="control-group">
        <div className="control-label">Latest Reflection Snapshot</div>
        <pre className="context-preview">
          {relationshipMemory.diaryEntry
            ? relationshipMemory.diaryEntry
            : 'No diary entry written yet.'}
        </pre>
      </div>

      <div className="control-group">
        <div className="control-label">Reset Controls</div>
        <div className="btn-row">
          <button className="btn-tech secondary" onClick={onClearChat} type="button">
            Clear Chat
          </button>
          <button className="btn-tech secondary" onClick={onClearDraft} type="button">
            Clear Draft
          </button>
        </div>
        <div className="btn-row">
          <button className="btn-tech secondary" onClick={onClearMemory} type="button">
            Clear Memory
          </button>
          <button className="btn-tech danger" onClick={onResetContext} type="button">
            Reset All Context
          </button>
        </div>
        <div className="field-hint">
          Reset All Context clears chat history, draft text, relationship profile, memory store,
          semantic recall, pending assistant playback, and any in-flight reply for the current
          session.
        </div>
      </div>
    </>
  );
}
