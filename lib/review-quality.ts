export type ReviewQuality = {
  passed: boolean;
  score: number;
  warning: string;
};

function normalizeComment(comment: string) {
  return comment
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenSimilarity(left: string, right: string) {
  const leftTokens = new Set(normalizeComment(left).split(" ").filter(Boolean));
  const rightTokens = new Set(normalizeComment(right).split(" ").filter(Boolean));
  if (!leftTokens.size || !rightTokens.size) return 0;

  let overlap = 0;
  leftTokens.forEach((token) => {
    if (rightTokens.has(token)) overlap += 1;
  });

  return overlap / Math.max(leftTokens.size, rightTokens.size);
}

export function evaluateReviewQuality(
  comment: string,
  priorComments: string[],
  pastedWithoutEditing: boolean,
): ReviewQuality {
  const trimmed = comment.trim();
  const normalized = normalizeComment(trimmed);
  const words = normalized.split(" ").filter(Boolean);
  let score = 100;

  if (trimmed.length < 30) {
    return {
      passed: false,
      score: 0,
      warning: "Please provide useful feedback. Write at least 30 characters.",
    };
  }

  const repeated = priorComments.some(
    (prior) =>
      normalizeComment(prior) === normalized ||
      tokenSimilarity(prior, trimmed) >= 0.86,
  );

  if (repeated) {
    return {
      passed: false,
      score: 20,
      warning: "Please provide useful feedback. This comment repeats earlier feedback.",
    };
  }

  if (pastedWithoutEditing) score -= 50;
  if (words.length < 7) score -= 25;
  if (new Set(words).size / words.length < 0.55) score -= 30;
  if (/(.)\1{5,}/i.test(trimmed)) score -= 40;

  if (score < 60) {
    return {
      passed: false,
      score: Math.max(0, score),
      warning: pastedWithoutEditing
        ? "Please provide useful feedback. Personalize pasted text before submitting."
        : "Please provide useful feedback.",
    };
  }

  return {
    passed: true,
    score,
    warning: "",
  };
}
