'use strict';
/**
 * VerifyAI LCS Engine
 * Implements: Longest Common Subsequence for sentence-level plagiarism
 * Also: Smith-Waterman local alignment for partial matches
 */

class LCSEngine {
  /**
   * Tokenize text into words for LCS comparison
   */
  tokenize(text) {
    return text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter(w => w.length > 0);
  }

  /**
   * Compute LCS length between two token arrays (space-optimized)
   */
  lcsLength(tokensA, tokensB) {
    const m = tokensA.length;
    const n = tokensB.length;

    // Space-optimized DP: only keep two rows
    let prev = new Array(n + 1).fill(0);
    let curr = new Array(n + 1).fill(0);

    for (let i = 1; i <= m; i++) {
      for (let j = 1; j <= n; j++) {
        if (tokensA[i - 1] === tokensB[j - 1]) {
          curr[j] = prev[j - 1] + 1;
        } else {
          curr[j] = Math.max(prev[j], curr[j - 1]);
        }
      }
      [prev, curr] = [curr, new Array(n + 1).fill(0)];
    }

    return prev[n];
  }

  /**
   * Compute LCS and reconstruct the common subsequence
   */
  lcsSequence(tokensA, tokensB) {
    const m = tokensA.length;
    const n = tokensB.length;

    // Full DP table (limit to 500x500 for performance)
    const maxM = Math.min(m, 500);
    const maxN = Math.min(n, 500);
    const slicedA = tokensA.slice(0, maxM);
    const slicedB = tokensB.slice(0, maxN);

    const dp = Array.from({ length: maxM + 1 }, () => new Array(maxN + 1).fill(0));

    for (let i = 1; i <= maxM; i++) {
      for (let j = 1; j <= maxN; j++) {
        if (slicedA[i - 1] === slicedB[j - 1]) {
          dp[i][j] = dp[i - 1][j - 1] + 1;
        } else {
          dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
        }
      }
    }

    // Backtrack
    const result = [];
    let i = maxM, j = maxN;
    while (i > 0 && j > 0) {
      if (slicedA[i - 1] === slicedB[j - 1]) {
        result.unshift(slicedA[i - 1]);
        i--; j--;
      } else if (dp[i - 1][j] > dp[i][j - 1]) {
        i--;
      } else {
        j--;
      }
    }

    return result;
  }

  /**
   * LCS-based similarity ratio (normalized by max length)
   */
  lcsSimilarity(textA, textB) {
    const tokA = this.tokenize(textA);
    const tokB = this.tokenize(textB);
    if (tokA.length === 0 || tokB.length === 0) return 0;

    const lcsLen = this.lcsLength(tokA, tokB);
    // Normalize: LCS / max(|A|, |B|) — how much of the longer text is shared
    const sim = lcsLen / Math.max(tokA.length, tokB.length);
    return Math.min(sim, 1);
  }

  /**
   * Smith-Waterman Local Sequence Alignment
   * Dynamic programming algorithm to locate regions of high local similarity,
   * even if they are separated by gap tokens (e.g. mosaic patchwriting).
   * 
   * H[i, j] = max(
   *   0,
   *   H[i-1, j-1] + S(A_i, B_j),
   *   H[i-1, j] - GapPenalty,
   *   H[i, j-1] - GapPenalty
   * )
   */
  smithWatermanAlignment(textA, textB) {
    const tokA = this.tokenize(textA);
    const tokB = this.tokenize(textB);
    const m = Math.min(tokA.length, 300);
    const n = Math.min(tokB.length, 300);
    if (m === 0 || n === 0) return [];

    const MATCH_SCORE = 2;
    const MISMATCH_PENALTY = -1;
    const GAP_PENALTY = 1;

    // DP Matrix
    const H = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
    let maxScore = 0;
    const highScores = [];

    for (let i = 1; i <= m; i++) {
      for (let j = 1; j <= n; j++) {
        const match = tokA[i - 1] === tokB[j - 1] ? MATCH_SCORE : MISMATCH_PENALTY;
        
        const score = Math.max(
          0,
          H[i - 1][j - 1] + match,
          H[i - 1][j] - GAP_PENALTY,
          H[i][j - 1] - GAP_PENALTY
        );

        H[i][j] = score;

        // Keep track of high scoring local alignments
        if (score >= 6) { // Threshold for a "significant" local match (~3-4 consecutive words)
          highScores.push({ score, i, j });
          if (score > maxScore) maxScore = score;
        }
      }
    }

    // Sort by score and extract the top non-overlapping sequences
    highScores.sort((a, b) => b.score - a.score);
    const sequences = [];
    const usedI = new Set();
    const usedJ = new Set();

    for (const { score, i, j } of highScores) {
      if (usedI.has(i) || usedJ.has(j)) continue;
      
      // Backtrack from this local maximum to reconstruct the sequence
      let currI = i;
      let currJ = j;
      const sequenceTokens = [];

      while (currI > 0 && currJ > 0 && H[currI][currJ] > 0) {
        // Only mark exact matches as part of the visual sequence string
        if (tokA[currI - 1] === tokB[currJ - 1]) {
          sequenceTokens.unshift(tokA[currI - 1]);
        }
        usedI.add(currI);
        usedJ.add(currJ);

        const currentScore = H[currI][currJ];
        const match = tokA[currI - 1] === tokB[currJ - 1] ? MATCH_SCORE : MISMATCH_PENALTY;

        if (currentScore === H[currI - 1][currJ - 1] + match) {
          currI--; currJ--;
        } else if (currentScore === H[currI - 1][currJ] - GAP_PENALTY) {
          currI--;
        } else {
          currJ--;
        }
      }

      if (sequenceTokens.length >= 3) {
        sequences.push({
          phrase: sequenceTokens.join(' '),
          length: sequenceTokens.length,
          posA: currI,
          posB: currJ,
          alignmentScore: score
        });
      }

      if (sequences.length >= 10) break; // Limit to top 10 sequences
    }

    return sequences;
  }

  /**
   * Full LCS + Smith-Waterman analysis between two texts
   */
  analyze(textA, textB) {
    const sim = this.lcsSimilarity(textA, textB);
    const sequences = this.smithWatermanAlignment(textA, textB);
    const lcsWords = this.lcsSequence(this.tokenize(textA), this.tokenize(textB));

    return {
      lcsSimilarity: +sim.toFixed(4),
      lcsPercent: Math.round(sim * 100),
      commonSequences: sequences,
      lcsWordCount: lcsWords.length,
      lcsPreview: lcsWords.slice(0, 30).join(' ')
    };
  }

  /**
   * Bulk alignment: compare one text against many reference texts
   */
  compareAgainstMany(targetText, referenceTexts) {
    return referenceTexts.map((refText, idx) => ({
      index: idx,
      similarity: this.lcsSimilarity(targetText, refText),
      sequences: this.smithWatermanAlignment(targetText, refText).slice(0, 5)
    })).sort((a, b) => b.similarity - a.similarity);
  }
}

(typeof window !== 'undefined' ? window : self).LCSEngine = LCSEngine;
