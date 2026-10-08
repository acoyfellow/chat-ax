import type { RoomSkill } from './room-skills';

export const reviewRecipe = {
  name: 'review_this_mr',
  version: 3,
  digest: '03db1a5252adb506b07adebbe3a216922851ac09d0dcda3930528844233028a5',
} as const;

export const reviewsTodoSkill: RoomSkill = {
  name: 'reviews-todo',
  description: 'Perform deterministic, read-only pull or merge request review with current evidence and mutation gates.',
  body: `# Reviews Todo

Perform read-only pull or merge request review work using the verified speaker's connector. It works with any code host whose MCP server exposes the change, its diffs, discussions, approvals, and CI status.

## Required current evidence

1. Fetch the change and record its exact URL, project, number, author, source head SHA, target base SHA, draft state, and reported change count.
2. Fetch every changed file and diff page. Compare the number of complete diff entries with the reported change count. If they differ, stop as blocked and name the missing evidence.
3. Fetch all discussions and unresolved threads.
4. Fetch current approval state from an authoritative change or approvals response. Do not infer approval from discussion text.
5. Fetch the current pipeline and relevant failed or pending jobs.
6. Call the trusted review_this_mr tool and include its version and digest receipt.
7. Inspect changed code for concrete correctness, security, recovery, concurrency, compatibility, and test-evidence problems. Cite findings with repository-relative file paths and changed lines.
8. Re-read the change before finalizing and confirm the head SHA did not change.

## Output

Return exact head and base SHAs, pipeline and validation evidence with URLs, findings ordered by severity with changed-line citations, unresolved evidence, and the activated skill plus recipe version and digest.

Do not claim tests passed unless an authoritative pipeline or job receipt proves it. Do not post comments, approve, merge, resolve threads, or modify the code host without a separate exact authorization. Missing required evidence means BLOCKED, never complete.`,
  createdAt: '2026-09-07T00:00:00.000Z',
  updatedAt: '2026-09-07T00:00:00.000Z',
  createdBy: 'chat-ax:built-in',
  updatedBy: 'chat-ax:built-in',
};

type ReviewNote = { author: string; body: string; createdAt: string };
type ReviewDiscussion = { resolved: boolean; notes: ReviewNote[] };
export type ReviewRecipeInput = {
  reviewer: string;
  mergeRequest: {
    author: string;
    draft: boolean;
    approvedBy: string[];
    discussions: ReviewDiscussion[];
    state?: 'opened' | 'closed' | 'merged';
    [key: string]: unknown;
  };
};

export function runReviewRecipe(input: ReviewRecipeInput) {
  const mr = input.mergeRequest;
  const reviewer = input.reviewer;
  const state = String(mr.state ?? '').toLowerCase();
  const terminalNextAction = state === 'closed' ? 'none_mr_closed' : state === 'merged' ? 'none_mr_merged' : null;
  if (terminalNextAction) return { row: { ...mr, reviewedByMe: false, approvedByMe: false, myUnresolvedComments: 0, ownerActionNeeded: false, ownerReplied: false, authorChangedAfterMyReview: false, unresolvedDiscussions: 0, nextAction: terminalNextAction } };
  const discussions = Array.isArray(mr.discussions) ? mr.discussions : [];
  const notesFor = (discussion: ReviewDiscussion) => Array.isArray(discussion.notes) ? discussion.notes : [];
  const unresolvedDiscussions = discussions.filter(discussion => !discussion.resolved);
  const reviewerNotes = discussions.flatMap(notesFor).filter(note => note.author === reviewer);
  const latestReviewerNoteAt = reviewerNotes.reduce((latest, note) => note.createdAt > latest ? note.createdAt : latest, '');
  const myUnresolvedComments = unresolvedDiscussions.filter(discussion => notesFor(discussion).some(note => note.author === reviewer)).length;
  const reviewedByMe = reviewerNotes.length > 0;
  const approvedByMe = Array.isArray(mr.approvedBy) && mr.approvedBy.includes(reviewer);
  const ownerActionNeeded = mr.author !== reviewer && myUnresolvedComments > 0;
  const ownerReplied = mr.author !== reviewer && unresolvedDiscussions.some(discussion => {
    const latestReviewerAt = notesFor(discussion).filter(note => note.author === reviewer).reduce((latest, note) => note.createdAt > latest ? note.createdAt : latest, '');
    return Boolean(latestReviewerAt) && notesFor(discussion).some(note => note.author === mr.author && note.createdAt > latestReviewerAt);
  });
  const authorChangedAfterMyReview = mr.author !== reviewer && Boolean(latestReviewerNoteAt) && discussions.flatMap(notesFor).some(note => note.author === mr.author && note.createdAt > latestReviewerNoteAt && /\b(?:added|pushed|mentioned)\b[\s\S]*\bcommit(?:s)?\b/i.test(String(note.body ?? '')));
  const nextAction = mr.draft ? 'wait_for_draft_to_end' : authorChangedAfterMyReview ? 're_review_after_owner_reply' : ownerActionNeeded ? 'wait_for_owner' : approvedByMe ? 'monitor_pipeline' : reviewedByMe ? 'resolve_or_approve' : 'review_needed';
  return { row: { ...mr, reviewedByMe, approvedByMe, myUnresolvedComments, ownerActionNeeded, ownerReplied, authorChangedAfterMyReview, unresolvedDiscussions: unresolvedDiscussions.length, nextAction } };
}
