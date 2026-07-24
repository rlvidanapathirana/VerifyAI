'use strict';
/**
 * VerifyAI NLP Engine — V6 Hybrid Retrieval Architecture
 *
 * Upgrades based on research document:
 *  - BM25 sparse retrieval (lexical overlap, Okapi BM25)
 *  - Sliding-window chunk indexing (4 sentences, stride 2)
 *  - Mosaic plagiarism detection (discontinuous multi-segment matching)
 *  - Boilerplate/template exclusion filter
 *  - TF-IDF cosine, N-gram Jaccard (retained and reweighted)
 */

const STOP_WORDS = new Set([
  'a','an','the','and','or','but','in','on','at','to','for','of','with','by','from',
  'up','about','into','through','during','before','after','above','below','between',
  'each','every','all','both','few','more','most','other','some','such','no','nor',
  'not','only','own','same','so','than','too','very','can','will','just','should',
  'now','is','are','was','were','be','been','being','have','has','had','do','does',
  'did','would','could','shall','may','might','must','i','you','he','she','it',
  'we','they','me','him','her','us','them','my','your','his','its','our','their',
  'this','that','these','those','what','which','who','when','where','why','how',
  'if','as','also','then','there','here','were','been','its','am','any','get',
  'got','let','put','say','said','see','saw','come','came','go','went','take',
  'made','make','know','think','look','use','find','give','tell','work','call'
]);

/**
 * Boilerplate phrases found in conference templates, licensing clauses,
 * and institutional introductions — excluded from plagiarism scoring.
 * Implements the "base-code / boilerplate exclusion" from the research document.
 */
const BOILERPLATE_PHRASES = [
  'all rights reserved', 'permission to make digital', 'this work is licensed under',
  'creative commons attribution', 'proceedings of the', 'published by', 'submitted to',
  'department of', 'corresponding author', 'abstract', 'keywords', 'index terms',
  'received:', 'revised:', 'accepted:', 'in partial fulfillment', 'thesis submitted',
  'all authors read and approved', 'the authors declare no conflict', 'funding:',
  'acknowledgements', 'copyright notice', 'as shown in figure', 'as shown in table',
  'figure shows', 'table shows',
];

class NLPEngine {

  // ─── Tokenizers ────────────────────────────────────────────────────────────

  tokenize(text) {
    return text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter(w => w.length > 2 && !STOP_WORDS.has(w));
  }

  tokenizeAll(text) {
    return text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter(w => w.length > 0);
  }

  splitSentences(text) {
    const raw = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    const sentenceRegex = /[^.!?\n]+(?:[.!?]+|$)/g;
    const results = [];
    let match;
    while ((match = sentenceRegex.exec(raw)) !== null) {
      const s = match[0].trim();
      if (s.length > 15 && s.split(/\s+/).length >= 4) results.push(s);
    }
    return results;
  }

  // ─── Boilerplate Filter ────────────────────────────────────────────────────

  isBoilerplate(sentence) {
    const lower = sentence.toLowerCase();
    return BOILERPLATE_PHRASES.some(p => lower.includes(p));
  }

  removeBoilerplate(sentences) {
    return sentences.filter(s => !this.isBoilerplate(s));
  }

  // ─── BM25 Sparse Retrieval (Okapi BM25) ───────────────────────────────────

  /**
   * Okapi BM25 scoring — industry standard for sparse lexical retrieval.
   * Used by Elasticsearch, Lucene, and all production-grade search engines.
   * Parameters: k1=1.5 (term saturation), b=0.75 (length normalization).
   * These are the canonical defaults proven optimal on academic text corpora.
   */
  bm25Score(queryTokens, docTokens, avgDocLen = 150) {
    const k1 = 1.5, b = 0.75;
    const docLen = docTokens.length;
    const docTF = {};
    docTokens.forEach(t => { docTF[t] = (docTF[t] || 0) + 1; });

    let score = 0;
    const uniqueQuery = new Set(queryTokens);
    uniqueQuery.forEach(term => {
      const tf = docTF[term] || 0;
      if (tf === 0) return;
      const idf = Math.log(1 + (1 / (tf / docLen + 0.001)));
      const numerator   = tf * (k1 + 1);
      const denominator = tf + k1 * (1 - b + b * (docLen / avgDocLen));
      score += idf * (numerator / denominator);
    });

    return Math.min(score / (uniqueQuery.size * 3 || 1), 1);
  }

  bm25Similarity(textA, textB) {
    const tokA = this.tokenize(textA);
    const tokB = this.tokenize(textB);
    if (tokA.length === 0 || tokB.length === 0) return 0;
    const avgLen = (tokA.length + tokB.length) / 2;
    const scoreAB = this.bm25Score(tokA, tokB, avgLen);
    const scoreBA = this.bm25Score(tokB, tokA, avgLen);
    return (scoreAB + scoreBA) / 2;
  }

  // ─── Sliding Window Chunk Indexer ──────────────────────────────────────────

  /**
   * Segments text into overlapping windows of sentences.
   * Architecture from the research document:
   *   window_size = 4 sentences, stride = 2 sentences
   * This preserves contextual proximity and detects localized segment overlaps.
   */
  buildSlidingWindowChunks(text, windowSize = 4, stride = 2) {
    const sentences = this.removeBoilerplate(this.splitSentences(text));
    if (sentences.length === 0) return [text];
    const chunks = [];
    for (let i = 0; i < sentences.length; i += stride) {
      const window = sentences.slice(i, i + windowSize);
      if ((typeof window !== 'undefined' ? window : self).length < 2 && chunks.length > 0) break;
      chunks.push((typeof window !== 'undefined' ? window : self).join(' '));
    }
    return chunks.length > 0 ? chunks : [text];
  }

  /**
   * Compare submission against reference using sliding window chunks.
   * Implements Stage 1 (Candidate Retrieval) of the hybrid pipeline.
   * Uses BM25 + TF-IDF cosine per chunk for high-recall segment matching.
   */
  slidingWindowAnalysis(submission, reference) {
    const subChunks = this.buildSlidingWindowChunks(submission);
    const refChunks = this.buildSlidingWindowChunks(reference);

    const segmentMatches = [];
    let totalScore = 0;

    subChunks.forEach((subChunk, si) => {
      const subTok = this.tokenize(subChunk);
      if (subTok.length < 3) return;

      let bestScore = 0, bestRefIdx = -1, bestRefChunk = '';

      refChunks.forEach((refChunk, ri) => {
        const refTok = this.tokenize(refChunk);
        if (refTok.length < 3) return;
        const bm  = this.bm25Similarity(subChunk, refChunk);
        const vA  = this.tfidfVector(subTok, [subTok, refTok]);
        const vB  = this.tfidfVector(refTok, [subTok, refTok]);
        const cos = this.cosineSimilarity(vA, vB);
        const combined = (bm * 0.5) + (cos * 0.5);
        if (combined > bestScore) { bestScore = combined; bestRefIdx = ri; bestRefChunk = refChunk; }
      });

      if (bestScore > 0.35) {
        segmentMatches.push({
          submissionSegment: subChunk.substring(0, 160) + (subChunk.length > 160 ? '...' : ''),
          referenceSegment:  bestRefChunk.substring(0, 160) + (bestRefChunk.length > 160 ? '...' : ''),
          score:             +bestScore.toFixed(4),
          submissionIndex:   si,
          referenceIndex:    bestRefIdx,
          percentMatch:      Math.round(bestScore * 100)
        });
        totalScore += bestScore;
      }
    });

    const overallScore = subChunks.length > 0 ? Math.min(totalScore / subChunks.length, 1) : 0;
    const mosaicSegments = this.detectMosaicPattern(segmentMatches);

    return {
      overallScore:   +overallScore.toFixed(4),
      overallPercent: Math.round(overallScore * 100),
      segmentMatches: segmentMatches.sort((a, b) => b.score - a.score).slice(0, 15),
      segmentCount:   segmentMatches.length,
      mosaicDetected: mosaicSegments.length >= 3,
      mosaicSegments,
    };
  }

  /**
   * Detect mosaic plagiarism (patchwriting):
   * Multiple discontinuous segment matches = text spliced from different
   * sections of an external source. Classic indicator of patchwriting.
   */
  detectMosaicPattern(segmentMatches) {
    if (segmentMatches.length < 2) return [];
    const sorted = [...segmentMatches].sort((a, b) => a.submissionIndex - b.submissionIndex);
    const mosaic = [];
    for (let i = 0; i < sorted.length - 1; i++) {
      const gap = sorted[i + 1].submissionIndex - sorted[i].submissionIndex;
      if (gap > 1 && sorted[i].score > 0.45 && sorted[i + 1].score > 0.45) mosaic.push(sorted[i]);
    }
    return mosaic;
  }

  // ─── TF-IDF ────────────────────────────────────────────────────────────────

  termFrequency(tokens) {
    const tf = {};
    tokens.forEach(t => { tf[t] = (tf[t] || 0) + 1; });
    const total = tokens.length || 1;
    Object.keys(tf).forEach(k => tf[k] = tf[k] / total);
    return tf;
  }

  tfidfVector(docTokens, allDocTokens) {
    const N = allDocTokens.length;
    const tf = this.termFrequency(docTokens);
    const df = {};
    allDocTokens.forEach(tokens => { const seen = new Set(tokens); seen.forEach(t => { df[t] = (df[t] || 0) + 1; }); });
    const vec = {};
    Object.keys(tf).forEach(term => {
      const idf = Math.log((N + 1) / ((df[term] || 0) + 1)) + 1;
      vec[term] = tf[term] * idf;
    });
    return vec;
  }

  cosineSimilarity(vecA, vecB) {
    const allTerms = new Set([...Object.keys(vecA), ...Object.keys(vecB)]);
    let dot = 0, magA = 0, magB = 0;
    allTerms.forEach(term => {
      const a = vecA[term] || 0; const b = vecB[term] || 0;
      dot += a * b; magA += a * a; magB += b * b;
    });
    if (magA === 0 || magB === 0) return 0;
    return Math.min(dot / (Math.sqrt(magA) * Math.sqrt(magB)), 1);
  }

  // ─── N-gram ────────────────────────────────────────────────────────────────

  ngrams(tokens, n) {
    const grams = [];
    for (let i = 0; i <= tokens.length - n; i++) grams.push(tokens.slice(i, i + n).join(' '));
    return grams;
  }

  jaccardSimilarity(arrA, arrB) {
    const setA = new Set(arrA), setB = new Set(arrB);
    const intersection = new Set([...setA].filter(x => setB.has(x)));
    return setA.size === 0 ? 0 : intersection.size / setA.size;
  }

  getMatchingPhrases(tokensA, tokensB, n = 4) {
    const gramsA = this.ngrams(tokensA, n);
    const setB   = new Set(this.ngrams(tokensB, n));
    return [...new Set(gramsA.filter(g => setB.has(g)))];
  }

  // ─── Hybrid Similarity (BM25 + TF-IDF + N-gram) ───────────────────────────

  analyzeSimilarity(textA, textB) {
    const tokA   = this.tokenize(textA);
    const tokB   = this.tokenize(textB);
    const allA   = this.tokenizeAll(textA);
    const allB   = this.tokenizeAll(textB);

    const vecA   = this.tfidfVector(tokA, [tokA, tokB]);
    const vecB   = this.tfidfVector(tokB, [tokA, tokB]);
    const cosine = this.cosineSimilarity(vecA, vecB);
    const bm25   = this.bm25Similarity(textA, textB);

    const bigram   = this.jaccardSimilarity(this.ngrams(tokA, 2), this.ngrams(tokB, 2));
    const trigram  = this.jaccardSimilarity(this.ngrams(tokA, 3), this.ngrams(tokB, 3));
    const fourgram = this.jaccardSimilarity(this.ngrams(allA, 4), this.ngrams(allB, 4));

    const matched3 = this.getMatchingPhrases(allA, allB, 3);
    const matched5 = this.getMatchingPhrases(allA, allB, 5);

    // Hybrid weighted combination — BM25 added as per research document
    const combined = Math.min(
      (cosine   * 0.30) +
      (bm25     * 0.25) +
      (bigram   * 0.18) +
      (trigram  * 0.17) +
      (fourgram * 0.10),
      1
    );

    return {
      cosine:            +cosine.toFixed(4),
      bm25:              +bm25.toFixed(4),
      bigramJaccard:     +bigram.toFixed(4),
      trigramJaccard:    +trigram.toFixed(4),
      fourgramJaccard:   +fourgram.toFixed(4),
      combined:          +combined.toFixed(4),
      plagiarismPercent: Math.round(combined * 100),
      matchingPhrases:   [...new Set([...matched3, ...matched5])].slice(0, 25)
    };
  }

  // ─── Sentence Matching ─────────────────────────────────────────────────────

  getSentenceMatches(textA, textB, threshold = 0.45) {
    const sentA = this.splitSentences(textA);
    const sentB = this.splitSentences(textB);
    const matches = [];

    sentA.forEach((sA, iA) => {
      if (this.isBoilerplate(sA)) return;
      const tokA = this.tokenize(sA);
      if (tokA.length < 3) return;
      let bestSim = 0, bestSB = '', bestIB = -1;

      sentB.forEach((sB, iB) => {
        if (this.isBoilerplate(sB)) return;
        const tokB = this.tokenize(sB);
        if (tokB.length < 3) return;
        const vA = this.tfidfVector(tokA, [tokA, tokB]);
        const vB = this.tfidfVector(tokB, [tokA, tokB]);
        const sim = this.cosineSimilarity(vA, vB);
        if (sim > bestSim) { bestSim = sim; bestSB = sB; bestIB = iB; }
      });

      if (bestSim >= threshold) {
        matches.push({ sentenceA: sA, sentenceB: bestSB, similarity: +bestSim.toFixed(4), indexA: iA, indexB: bestIB });
      }
    });

    return matches.sort((a, b) => b.similarity - a.similarity).slice(0, 20);
  }

  // ─── Bulk Matrix ───────────────────────────────────────────────────────────

  buildSimilarityMatrix(texts) {
    const n = texts.length;
    const matrix = Array.from({ length: n }, () => Array(n).fill(0));
    const tokenized = texts.map(t => this.tokenize(t));
    for (let i = 0; i < n; i++) {
      matrix[i][i] = 1;
      for (let j = i + 1; j < n; j++) {
        const vecI = this.tfidfVector(tokenized[i], tokenized);
        const vecJ = this.tfidfVector(tokenized[j], tokenized);
        const sim  = this.cosineSimilarity(vecI, vecJ);
        matrix[i][j] = +sim.toFixed(4);
        matrix[j][i] = +sim.toFixed(4);
      }
    }
    return matrix;
  }

  // ─── Text Stats ────────────────────────────────────────────────────────────

  getTextStats(text) {
    const words      = text.trim().split(/\s+/).filter(w => w.length > 0);
    const sentences  = this.splitSentences(text);
    const uniqueWords = new Set(words.map(w => w.toLowerCase()));
    const chars      = text.replace(/\s/g, '').length;
    const avgSentLen = words.length / (sentences.length || 1);
    const readingTime = Math.max(1, Math.ceil(words.length / 200));
    return {
      wordCount:         words.length,
      sentenceCount:     sentences.length,
      charCount:         chars,
      uniqueWordCount:   uniqueWords.size,
      lexicalDiversity:  +(uniqueWords.size / (words.length || 1)).toFixed(3),
      avgSentenceLength: +avgSentLen.toFixed(1),
      readingTime
    };
  }
}

(typeof window !== 'undefined' ? window : self).NLPEngine = NLPEngine;
