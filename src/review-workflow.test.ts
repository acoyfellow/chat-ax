import { describe, expect, test } from 'bun:test';
import { reviewRecipe, reviewsTodoSkill, runReviewRecipe } from './review-workflow';

describe('trusted review workflow', () => {
  test('pins the mounted skill and employee recipe identity', () => {
    expect(reviewsTodoSkill.name).toBe('reviews-todo');
    expect(reviewRecipe).toEqual({
      name: 'review_this_mr',
      version: 3,
      digest: '03db1a5252adb506b07adebbe3a216922851ac09d0dcda3930528844233028a5',
    });
  });

  test('classifies a first review from current evidence', () => {
    const result = runReviewRecipe({
      reviewer: 'maya',
      mergeRequest: {
        author: 'someone-else',
        draft: false,
        approvedBy: [],
        discussions: [],
        state: 'opened',
      },
    });
    expect(result.row.nextAction).toBe('review_needed');
    expect(result.row.reviewedByMe).toBe(false);
    expect(result.row.approvedByMe).toBe(false);
  });

  test('does not request action for a merged MR', () => {
    const result = runReviewRecipe({
      reviewer: 'maya',
      mergeRequest: {
        author: 'someone-else',
        draft: false,
        approvedBy: [],
        discussions: [],
        state: 'merged',
      },
    });
    expect(result.row.nextAction).toBe('none_mr_merged');
  });
});
