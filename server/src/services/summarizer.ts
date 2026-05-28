import { converseOnce } from "../bedrock/converse.js";
import {
  getProject,
  getProjectMessagesAfter,
  getSettings,
  updateProject,
} from "../db/repo.js";

const SUMMARY_SYSTEM = `You maintain a rolling memory summary for a project's chats.
Merge the NEW MESSAGES into the EXISTING SUMMARY. Preserve names, dates, decisions,
and open threads. Remove information that has been superseded. Be concise and factual —
do not invent details. Output well-structured markdown using exactly these sections
(omit a section only if it would be empty):

## People
## Dates & Events
## Decisions
## Open Threads
## Other Facts

Keep the whole summary under ~2000 tokens.`;

// In-memory locks keyed by project id. SQLite is single-process so this is
// sufficient to prevent overlapping summarize runs clobbering each other.
const locks = new Set<number>();

export class SummarizeBusyError extends Error {
  constructor() {
    super("A summary is already being generated for this project.");
    this.name = "SummarizeBusyError";
  }
}

export class NoSummarizerModelError extends Error {
  constructor() {
    super(
      "No summarizer model is configured. Set one in Settings (e.g. a Haiku or Nova Lite model)."
    );
    this.name = "NoSummarizerModelError";
  }
}

export async function summarizeProject(projectId: number): Promise<string> {
  if (locks.has(projectId)) throw new SummarizeBusyError();

  const project = getProject(projectId);
  if (!project) throw new Error("Project not found");

  const settings = getSettings();
  const model = settings.defaultSummarizerModelId;
  if (!model) throw new NoSummarizerModelError();

  locks.add(projectId);
  try {
    const watermark = project.summaryThroughMessageId ?? 0;
    const newMessages = getProjectMessagesAfter(projectId, watermark);

    if (newMessages.length === 0) {
      // Nothing new — return the existing summary unchanged.
      return project.rollingSummary;
    }

    const transcript = newMessages
      .map((m) => `${m.role.toUpperCase()}: ${m.text}`)
      .join("\n\n");

    const userText = [
      "EXISTING SUMMARY:",
      project.rollingSummary || "(none yet)",
      "",
      "NEW MESSAGES:",
      transcript,
    ].join("\n");

    const summary = await converseOnce({
      modelId: model,
      systemText: SUMMARY_SYSTEM,
      userText,
      temperature: 0.2,
      maxTokens: 3000,
    });

    const lastId = newMessages[newMessages.length - 1].id;
    updateProject(projectId, {
      rollingSummary: summary,
      summaryThroughMessageId: lastId,
    });

    return summary;
  } finally {
    locks.delete(projectId);
  }
}
