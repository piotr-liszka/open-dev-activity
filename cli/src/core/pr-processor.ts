import type { PullRequestNode, PullRequestInfo, ReviewInfo, CommentInfo } from '../types.js';
import dayjs, { type Dayjs } from 'dayjs';

/**
 * Process a PullRequestNode from GitHub GraphQL API into a normalized PullRequestInfo
 * This function extracts and normalizes pull request data including reviews and comments
 * 
 * @param pr - The PullRequestNode from GitHub's GraphQL API
 * @param toDate - The end date for calculating PR lifetime
 * @returns PullRequestInfo with normalized review and comment data
 */
export function processPR(pr: PullRequestNode, toDate: Dayjs): PullRequestInfo {
  const createdAt = dayjs(pr.createdAt);
  const closedAt = pr.closedAt ? dayjs(pr.closedAt) : null;
  const endDate = closedAt || toDate;
  
  // Calculate PR lifetime
  const lifetimeMs = endDate.diff(createdAt);
  
  // Process reviews
  const reviews: ReviewInfo[] = [];
  if (pr.reviews?.nodes) {
    for (const review of pr.reviews.nodes) {
      if (review.author?.login) {
        reviews.push({
          who: review.author.login,
          when: review.createdAt,
          state: review.state.toLowerCase(),
          body: review.body || '',
        });
      }
    }
  }
  
  // Process comments (both regular comments and review thread comments)
  const comments: CommentInfo[] = [];
  
  // Regular comments
  if (pr.comments?.nodes) {
    for (const comment of pr.comments.nodes) {
      if (comment.author?.login) {
        comments.push({
          who: comment.author.login,
          when: comment.createdAt,
          text: comment.body || '',
        });
      }
    }
  }
  
  // Review thread comments
  if (pr.reviewThreads?.nodes) {
    for (const thread of pr.reviewThreads.nodes) {
      if (thread.comments?.nodes) {
        for (const comment of thread.comments.nodes) {
          if (comment.author?.login) {
            comments.push({
              who: comment.author.login,
              when: comment.createdAt,
              text: comment.body || '',
            });
          }
        }
      }
    }
  }
  
  // Sort comments by date
  comments.sort((a, b) => dayjs(a.when).diff(dayjs(b.when)));
  
  // Sort reviews by date
  reviews.sort((a, b) => dayjs(a.when).diff(dayjs(b.when)));
  
  // Check if there are any "changes requested" reviews
  const requestChangesReviews = reviews.filter(r => 
    r.state === 'changes_requested' || r.state === 'request_changes'
  );
  
  const isRequestChanges = requestChangesReviews.length > 0;
  const requestedChangesBy = isRequestChanges ? {
    who: requestChangesReviews[0].who,
    when: requestChangesReviews[0].when,
  } : undefined;
  
  return {
    number: pr.number,
    title: pr.title,
    url: pr.url,
    createdAt: pr.createdAt,
    closedAt: pr.closedAt,
    changedFiles: pr.changedFiles,
    author: pr.author?.login || 'unknown',
    reviews,
    comments,
    isRequestChanges,
    requestedChangesBy,
    lifetimeMs,
  };
}

/**
 * Calculate PR metrics for analysis
 * 
 * @param pr - The processed pull request info
 * @returns Object containing various PR metrics
 */
export function calculatePRMetrics(pr: PullRequestInfo): {
  timeToFirstReview?: number;
  timeToApproval?: number;
  timeToMerge?: number;
  reviewCycles: number;
  totalComments: number;
  uniqueReviewers: number;
} {
  const createdAt = dayjs(pr.createdAt);
  const closedAt = pr.closedAt ? dayjs(pr.closedAt) : null;
  
  // Time to first review
  const firstReview = pr.reviews.length > 0 ? dayjs(pr.reviews[0].when) : null;
  const timeToFirstReview = firstReview ? firstReview.diff(createdAt) : undefined;
  
  // Time to approval (first approved review)
  const firstApproval = pr.reviews.find(r => r.state === 'approved');
  const timeToApproval = firstApproval ? dayjs(firstApproval.when).diff(createdAt) : undefined;
  
  // Time to merge/close
  const timeToMerge = closedAt ? closedAt.diff(createdAt) : undefined;
  
  // Count review cycles (changes requested followed by new commits/reviews)
  let reviewCycles = 0;
  let hasRequestedChanges = false;
  
  for (const review of pr.reviews) {
    if (review.state === 'changes_requested' || review.state === 'request_changes') {
      hasRequestedChanges = true;
    } else if (hasRequestedChanges && (review.state === 'approved' || review.state === 'commented')) {
      reviewCycles++;
      hasRequestedChanges = false;
    }
  }
  
  // Unique reviewers (excluding the PR author)
  const reviewers = new Set(
    pr.reviews
      .map(r => r.who)
      .filter(who => who !== pr.author)
  );
  
  return {
    timeToFirstReview,
    timeToApproval,
    timeToMerge,
    reviewCycles,
    totalComments: pr.comments.length,
    uniqueReviewers: reviewers.size,
  };
}

/**
 * Analyze PR review patterns for insights
 * 
 * @param pr - The processed pull request info
 * @returns Object containing review pattern analysis
 */
export function analyzePRReviewPatterns(pr: PullRequestInfo): {
  hasBackAndForth: boolean;
  avgTimeBetweenReviews: number;
  reviewerEngagement: Record<string, {
    reviewCount: number;
    commentCount: number;
    lastActivity: string;
  }>;
} {
  const reviewerStats: Record<string, {
    reviewCount: number;
    commentCount: number;
    lastActivity: string;
  }> = {};
  
  // Count reviews per reviewer
  for (const review of pr.reviews) {
    if (review.who !== pr.author) {
      if (!reviewerStats[review.who]) {
        reviewerStats[review.who] = {
          reviewCount: 0,
          commentCount: 0,
          lastActivity: review.when,
        };
      }
      reviewerStats[review.who].reviewCount++;
      reviewerStats[review.who].lastActivity = review.when;
    }
  }
  
  // Count comments per reviewer
  for (const comment of pr.comments) {
    if (comment.who !== pr.author) {
      if (!reviewerStats[comment.who]) {
        reviewerStats[comment.who] = {
          reviewCount: 0,
          commentCount: 0,
          lastActivity: comment.when,
        };
      }
      reviewerStats[comment.who].commentCount++;
      
      // Update last activity if this comment is more recent
      if (dayjs(comment.when).isAfter(dayjs(reviewerStats[comment.who].lastActivity))) {
        reviewerStats[comment.who].lastActivity = comment.when;
      }
    }
  }
  
  // Check for back-and-forth (multiple reviews or comments from same person)
  const hasBackAndForth = Object.values(reviewerStats).some(
    stats => stats.reviewCount + stats.commentCount > 1
  );
  
  // Calculate average time between reviews
  let avgTimeBetweenReviews = 0;
  if (pr.reviews.length > 1) {
    const intervals = [];
    for (let i = 1; i < pr.reviews.length; i++) {
      const current = dayjs(pr.reviews[i].when);
      const previous = dayjs(pr.reviews[i - 1].when);
      intervals.push(current.diff(previous));
    }
    avgTimeBetweenReviews = intervals.reduce((sum, interval) => sum + interval, 0) / intervals.length;
  }
  
  return {
    hasBackAndForth,
    avgTimeBetweenReviews,
    reviewerEngagement: reviewerStats,
  };
}
