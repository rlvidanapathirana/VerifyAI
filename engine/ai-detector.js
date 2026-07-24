'use strict';
/**
 * VerifyAI AI Content Detector
 * Uses statistical NLP heuristics to detect AI-generated text:
 *  - Perplexity proxy (n-gram predictability)
 *  - Burstiness (sentence length variation)
 *  - Lexical diversity (TTR, Hapax ratio)
 *  - Punctuation regularity
 *  - Vocabulary richness (Yule K, Herdan C)
 *  - Sentence structure uniformity
 *  - Transition word density
 *  - Average word length deviation
 */

const AI_TRANSITION_WORDS = new Set([
  'furthermore','moreover','additionally','consequently','therefore','however',
  'nevertheless','nonetheless','subsequently','accordingly','hence','thus',
  'notably','specifically','importantly','essentially','ultimately','overall',
  'significantly','particularly','primarily','generally','typically','commonly',
  'frequently','occasionally','ultimately','comprehensively','systematically',
  'effectively','efficiently','accurately','precisely','thoroughly','extensively',
  'in conclusion','in summary','to summarize','as a result','on the other hand',
  'it is important to','it should be noted','it is worth mentioning',
  'one of the key','in order to','with respect to','in terms of','in this context',
  'it is essential','play a crucial role','plays an important role',
  'this ensures','this allows','this enables','this provides','this helps',
  'delve','straightforward','notable','commendable','invaluable','multifaceted',
  'nuanced','robust','seamless','cutting-edge','game-changing','paradigm',
  'leverage','utilize','implement','facilitate','encompass','harness'
]);

const COMMON_AI_PHRASES = [
  'as an ai', 'i cannot', 'i am unable', 'i do not have', 'as a language model',
  'in the realm of', 'it is worth noting', 'it is important to note',
  'in today\'s world', 'in today\'s society', 'in the modern era',
  'plays a crucial role', 'plays an important role', 'in recent years',
  'it goes without saying', 'needless to say', 'without a doubt',
  'in conclusion', 'to summarize', 'all in all', 'in a nutshell',
  'first and foremost', 'last but not least', 'on a final note',
  
  // Modern LLM (Gemini/Claude/GPT-4) specific markers
  'delve into', 'tapestry of', 'testament to', 'multifaceted', 'nuanced',
  'foster a', 'fostering a', 'in summary', 'ultimately', 'in essence',
  'moreover', 'furthermore', 'notably', 'it is crucial to', 'undeniably',
  'a stark reminder', 'sheds light on', 'intricate web', 'navigate the'
];

/**
 * Model-specific language fingerprints.
 * Each model has unique stylistic tells that differ from the generic AI pool.
 * Scores are cumulative — the model with the highest score wins.
 */
const MODEL_SIGNATURES = {
  'ChatGPT (OpenAI)': {
    icon: '🟢',
    phrases: [
      'certainly', 'absolutely', 'of course', 'great question', 'i understand',
      'i\'d be happy to', 'to be honest', 'let me explain', 'in simpler terms',
      'think of it this way', 'here\'s a breakdown', 'let\'s dive in',
      'keep in mind', 'it\'s worth noting', 'makes sense', 'hope this helps',
      'happy to help', 'feel free to ask', 'sure thing', 'as mentioned earlier'
    ],
    transitionStyle: ['firstly', 'secondly', 'thirdly', 'lastly', 'in short'],
    structureHints: ['numbered list', '1.', '2.', '3.', '**', '###'],
  },
  'Claude (Anthropic)': {
    icon: '🟠',
    phrases: [
      'i\'d like to note', 'it\'s worth emphasizing', 'crucially', 'importantly',
      'it\'s helpful to consider', 'let me be clear', 'i want to be transparent',
      'to be clear', 'that said', 'with that said', 'it\'s worth considering',
      'i should mention', 'at its core', 'in this context', 'fundamentally',
      'the key insight', 'worth highlighting', 'it bears mentioning',
      'to put it simply', 'the crux of', 'in practice'
    ],
    transitionStyle: ['moreover', 'furthermore', 'additionally', 'that said'],
    structureHints: [],
  },
  'Gemini (Google)': {
    icon: '🔵',
    phrases: [
      'here\'s a comprehensive', 'let me provide', 'i can help with that',
      'this is a great topic', 'to summarize the key points', 'in essence',
      'it\'s fascinating', 'exploring this further', 'building on this',
      'to add to this', 'a key takeaway', 'from a broader perspective',
      'looking at this holistically', 'from multiple angles', 'on a related note',
      'this highlights the importance', 'taking into account', 'across the board'
    ],
    transitionStyle: ['notably', 'interestingly', 'specifically', 'essentially'],
    structureHints: [],
  },
  'Perplexity AI': {
    icon: '🟣',
    phrases: [
      'according to', 'based on available information', 'research suggests',
      'studies indicate', 'evidence shows', 'data indicates', 'sources suggest',
      'as reported by', 'it has been found that', 'experts suggest',
      'current evidence', 'available data', 'recent research', 'findings indicate'
    ],
    transitionStyle: ['according to', 'based on', 'as evidenced by'],
    structureHints: [],
  },
  'xAI Grok': {
    icon: '⚫',
    phrases: [
      'to be blunt', 'frankly', 'let\'s be real', 'the reality is',
      'cut to the chase', 'no sugarcoating', 'in no uncertain terms',
      'plain and simple', 'bottom line', 'straight up', 'the hard truth',
      'let\'s face it', 'to put it bluntly', 'spoiler', 'plot twist'
    ],
    transitionStyle: ['however', 'but', 'yet', 'still', 'regardless'],
    structureHints: [],
  }
};

class AIDetector {
  /**
   * Tokenize into words (keep stop words for statistical analysis)
   */
  tokenize(text) {
    return text
      .toLowerCase()
      .replace(/[^a-z0-9'\s]/g, ' ')
      .split(/\s+/)
      .filter(w => w.length > 0);
  }

  /**
   * Split text into sentences
   */
  splitSentences(text) {
    const raw = text.trim();
    const parts = raw.split(/(?<=[.!?])\s+/);
    return parts.filter(s => s.split(/\s+/).length >= 3);
  }

  /**
   * 1. Burstiness Score (0=very uniform = AI-like, 1=very varied = human-like)
   * AI text tends to have very uniform sentence lengths.
   * Burstiness = coefficient of variation of sentence lengths
   */
  computeBurstiness(sentences) {
    if (sentences.length < 3) return 0.5;
    const lengths = sentences.map(s => s.split(/\s+/).length);
    const mean = lengths.reduce((a, b) => a + b, 0) / lengths.length;
    const variance = lengths.reduce((s, l) => s + Math.pow(l - mean, 2), 0) / lengths.length;
    const stdDev = Math.sqrt(variance);
    const cv = stdDev / (mean || 1); // Coefficient of Variation
    // CV < 0.3 = very uniform (AI-like), CV > 0.6 = varied (human-like)
    return Math.min(cv, 1.5) / 1.5;
  }

  /**
   * 2. Lexical Diversity (Type-Token Ratio)
   * AI often uses a broader, more uniform vocabulary
   */
  computeTTR(tokens) {
    if (tokens.length === 0) return 0;
    const unique = new Set(tokens);
    return unique.size / tokens.length;
  }

  /**
   * 3. Hapax Ratio (words appearing exactly once)
   * High hapax = varied unique words = more human
   */
  computeHapaxRatio(tokens) {
    if (tokens.length === 0) return 0;
    const freq = {};
    tokens.forEach(t => { freq[t] = (freq[t] || 0) + 1; });
    const hapax = Object.values(freq).filter(c => c === 1).length;
    return hapax / tokens.length;
  }

  /**
   * 4. Perplexity Proxy using unigram log-likelihood
   * AI models produce text with low perplexity (very predictable word sequences)
   * We approximate using unigram frequency distribution entropy
   */
  computePerplexityProxy(tokens) {
    if (tokens.length < 10) return 0.5;
    const freq = {};
    tokens.forEach(t => { freq[t] = (freq[t] || 0) + 1; });
    const total = tokens.length;
    // Shannon entropy of the word frequency distribution
    let entropy = 0;
    Object.values(freq).forEach(count => {
      const p = count / total;
      entropy -= p * Math.log2(p);
    });
    // Normalize entropy by log2(vocab size)
    const maxEntropy = Math.log2(Object.keys(freq).length || 1);
    const normalizedEntropy = maxEntropy > 0 ? entropy / maxEntropy : 0;
    return normalizedEntropy; // Higher = more uniform = more AI-like
  }

  /**
   * 5. Transition Word Density
   * AI tends to use more formal transitional phrases
   */
  computeTransitionDensity(text, sentences) {
    if (sentences.length === 0) return 0;
    const lower = text.toLowerCase();
    let transCount = 0;
    AI_TRANSITION_WORDS.forEach(word => {
      const regex = new RegExp(`\\b${word}\\b`, 'g');
      const matches = lower.match(regex);
      if (matches) transCount += matches.length;
    });
    // Normalize by sentence count
    return Math.min(transCount / sentences.length, 2) / 2;
  }

  /**
   * 6. Common AI Phrase Detection
   * Direct pattern matching for known AI clichés
   */
  detectAIPhrases(text) {
    const lower = text.toLowerCase();
    const found = [];
    COMMON_AI_PHRASES.forEach(phrase => {
      if (lower.includes(phrase)) found.push(phrase);
    });
    return found;
  }

  /**
   * 7. Average Word Length Consistency
   * AI tends to use consistently longer, more formal words
   */
  computeWordLengthStats(tokens) {
    if (tokens.length === 0) return { avg: 0, variance: 0, longWordRatio: 0 };
    const lengths = tokens.map(t => t.length);
    const avg = lengths.reduce((a, b) => a + b, 0) / lengths.length;
    const variance = lengths.reduce((s, l) => s + Math.pow(l - avg, 2), 0) / lengths.length;
    const longWords = lengths.filter(l => l > 8).length;
    return {
      avg: +avg.toFixed(2),
      variance: +variance.toFixed(2),
      longWordRatio: +(longWords / lengths.length).toFixed(3)
    };
  }

  /**
   * 8. Punctuation Pattern Analysis
   * AI tends to use semicolons, em-dashes and formal punctuation rarely
   * but has very consistent comma usage
   */
  computePunctuationScore(text) {
    const commas = (text.match(/,/g) || []).length;
    const semicolons = (text.match(/;/g) || []).length;
    const words = text.split(/\s+/).length;
    const commaRate = commas / (words || 1);
    // AI often has moderate, uniform comma rate
    // Very low or very high comma rate is more human
    const normalizedRate = Math.min(commaRate / 0.15, 1);
    return { commaRate: +commaRate.toFixed(3), semicolonCount: semicolons, uniformityScore: +normalizedRate.toFixed(3) };
  }

  /**
   * 9. Sentence Repetition (AI sometimes echoes structures)
   */
  computeStructuralRepetition(sentences) {
    if (sentences.length < 4) return 0;
    // Check if sentence starting words repeat
    const starters = sentences.map(s => s.split(/\s+/)[0]?.toLowerCase() || '');
    const freq = {};
    starters.forEach(w => { freq[w] = (freq[w] || 0) + 1; });
    const maxFreq = Math.max(...Object.values(freq));
    return Math.min(maxFreq / sentences.length, 1);
  }

  /**
   * 8. Gunning Fog Index (Readability/Formality Proxy)
   * AI text often targets an exact reading level (Fog index 10-14). 
   * Extreme highs or lows are more often human.
   */
  computeGunningFog(sentences, tokens) {
    if (sentences.length === 0 || tokens.length === 0) return 0.5;
    const complexWords = tokens.filter(t => t.length > 7).length; // crude syllable proxy
    const fog = 0.4 * ((tokens.length / sentences.length) + 100 * (complexWords / tokens.length));
    // Normal AI target is usually ~12-14. 
    const deviationFromAI = Math.abs(fog - 13);
    // Higher deviation = more human. 0 deviation = very AI.
    return Math.min(deviationFromAI / 8, 1);
  }

  /**
   * 9. Zipf's Law Deviation (from reference repo)
   * AI text has slightly higher top-10 word ratio (repetitive function words).
   * Human text has more diversity in top-10 word distribution.
   */
  computeZipfScore(tokens) {
    if (tokens.length === 0) return 0.5;
    const freq = {};
    tokens.forEach(w => { freq[w] = (freq[w] || 0) + 1; });
    const sorted = Object.values(freq).sort((a, b) => b - a);
    const top10 = sorted.slice(0, 10).reduce((a, b) => a + b, 0);
    const ratio = top10 / tokens.length;
    // AI text: ratio tends towards 0.25+; human text: < 0.18 or highly variable
    if (ratio > 0.28) return 0.65;       // Slightly AI-like
    if (ratio < 0.15) return 0.25;       // More human-like
    return 0.5;                           // Ambiguous
  }

  /**
   * 10. Sentence Uniformity Ratio (from reference repo)
   * Calculates what % of sentences fall in the 12-28 word "AI sweetspot".
   */
  computeSentenceUniformityRatio(sentences) {
    if (sentences.length === 0) return 0;
    const lengths = sentences.map(s => s.split(/\s+/).length);
    const aiRange = lengths.filter(l => l >= 12 && l <= 28).length;
    return Math.min((aiRange / lengths.length) * 1.2, 1.0);
  }

  /**
   * 11. Zero-Shot Generative AI Detection via Probability Curvature (Fast-DetectGPT Proxy)
   * Approximates token-by-token log-likelihood curvature.
   * Machine-generated text occupies local probability maximums (curvature ~3.0).
   * Human text explores lower probability regions (curvature ~0.0).
   * We proxy this by measuring the local variance of term predictability over rolling windows.
   */
  computeProbabilityCurvatureProxy(tokens) {
    if (tokens.length < 20) return { curvature: 0, aiLikelihood: 0 };
    
    // Estimate baseline unigram frequencies
    const freq = {};
    tokens.forEach(w => { freq[w] = (freq[w] || 0) + 1; });
    const total = tokens.length;
    
    // Calculate local log-probability proxies across rolling windows of 10 tokens
    const windowSize = 10;
    const localProbs = [];
    for (let i = 0; i <= tokens.length - windowSize; i++) {
      let windowProbSum = 0;
      for (let j = 0; j < windowSize; j++) {
        const p = freq[tokens[i + j]] / total;
        windowProbSum += Math.log2(p + 0.0001);
      }
      localProbs.push(windowProbSum / windowSize);
    }
    
    // Calculate the 'curvature' — the variance/volatility of these local probabilities
    // High variance/curvature = highly predictable sequences interspersed with structure = AI (curvature ~ 3.0)
    // Low variance/smooth = human text (curvature ~ 0.0)
    const meanProb = localProbs.reduce((a, b) => a + b, 0) / localProbs.length;
    const variance = localProbs.reduce((s, p) => s + Math.pow(p - meanProb, 2), 0) / localProbs.length;
    
    // Scale variance to approximate the 0.0 to 3.0 Fast-DetectGPT curvature scale
    const curvature = Math.min(variance * 2.5, 3.5); 
    
    // AI Likelihood: closer to 3.0 = highly likely AI.
    let aiLikelihood = 0;
    if (curvature > 2.5) aiLikelihood = 0.9;
    else if (curvature > 1.8) aiLikelihood = 0.6;
    else if (curvature > 1.0) aiLikelihood = 0.3;
    else aiLikelihood = 0.05;
    
    return { curvature: +curvature.toFixed(2), aiLikelihood };
  }

  /**
   * 12. Unsupervised Stylometric Clustering (Intrinsic Plagiarism)
   * Splits document into chunks and extracts stylometric feature vectors:
   * (Lexical Stats, Vocabulary Richness [Yule's K], Readability [Flesch-Kincaid]).
   * Calculates the variance across chunks. High variance = multi-author (patchwriting).
   */
  computeStylometricVariance(text) {
    const sentences = this.splitSentences(text);
    if (sentences.length < 8) return { varianceScore: 0, isMultiAuthor: false, yulesK: 0 };

    // Sliding window chunking (4 sentences per chunk)
    const chunks = [];
    for (let i = 0; i < sentences.length; i += 2) {
      const window = sentences.slice(i, i + 4);
      if ((typeof window !== 'undefined' ? window : self).length < 2) break;
      chunks.push((typeof window !== 'undefined' ? window : self).join(' '));
    }

    const featureVectors = chunks.map(chunk => {
      const toks = this.tokenize(chunk);
      const sents = this.splitSentences(chunk);
      
      // 1. Lexical: Average word length
      const avgWordLen = toks.reduce((sum, t) => sum + t.length, 0) / (toks.length || 1);
      
      // 2. Readability: Flesch-Kincaid Grade Level proxy
      const syllables = toks.reduce((sum, t) => sum + Math.max(1, Math.floor(t.length / 3)), 0);
      const fkGrade = 0.39 * (toks.length / (sents.length || 1)) + 11.8 * (syllables / (toks.length || 1)) - 15.59;
      
      // 3. Vocab Richness: Yule's K (K = 10^4 * [sum(V_r * r^2) - N] / N^2)
      const freq = {};
      toks.forEach(w => { freq[w] = (freq[w] || 0) + 1; });
      const N = toks.length;
      let M2 = 0;
      Object.values(freq).forEach(count => { M2 += count * count; });
      const yulesK = N > 1 ? 10000 * (M2 - N) / (N * N) : 0;
      
      return { avgWordLen, fkGrade, yulesK };
    });

    // Calculate document-level averages
    let meanAWL = 0, meanFK = 0, meanYule = 0;
    featureVectors.forEach(v => {
      meanAWL += v.avgWordLen;
      meanFK += v.fkGrade;
      meanYule += v.yulesK;
    });
    const N = featureVectors.length;
    meanAWL /= N; meanFK /= N; meanYule /= N;

    // Calculate variance of these features across chunks
    let varAWL = 0, varFK = 0, varYule = 0;
    featureVectors.forEach(v => {
      varAWL += Math.pow(v.avgWordLen - meanAWL, 2);
      varFK += Math.pow(v.fkGrade - meanFK, 2);
      varYule += Math.pow(v.yulesK - meanYule, 2);
    });
    varAWL /= N; varFK /= N; varYule /= N;

    // Normalize and combine variance into a single "Stylistic Inconsistency" score (0 to 1)
    // High variance means different authors wrote different parts (patchwriting/intrinsic plagiarism)
    const normalizedVariance = Math.min(
      (Math.sqrt(varAWL) / 2) * 0.3 + 
      (Math.sqrt(varFK) / 4) * 0.4 + 
      (Math.sqrt(varYule) / 100) * 0.3,
      1
    );

    return {
      varianceScore: +normalizedVariance.toFixed(3),
      isMultiAuthor: normalizedVariance > 0.45,
      yulesK: +meanYule.toFixed(1),
      fkGrade: +meanFK.toFixed(1)
    };
  }

  /**
   * 13. Model Signature Detection

   * Matches text against per-model phrase fingerprints.
   * Returns the model name + confidence score.
   */
  detectModelSignature(text) {
    const lower = text.toLowerCase();
    const scores = {};
    
    for (const [model, sig] of Object.entries(MODEL_SIGNATURES)) {
      let score = 0;
      sig.phrases.forEach(phrase => {
        // Count occurrences, not just presence
        let idx = lower.indexOf(phrase);
        while (idx !== -1) {
          score += 1;
          idx = lower.indexOf(phrase, idx + 1);
        }
      });
      sig.transitionStyle.forEach(t => {
        if (lower.includes(t)) score += 0.5;
      });
      scores[model] = score;
    }

    const entries = Object.entries(scores).sort((a, b) => b[1] - a[1]);
    const top = entries[0];
    const total = Object.values(scores).reduce((a, b) => a + b, 0);

    if (!top || top[1] === 0 || total < 2) {
      return { model: null, confidence: 0, icon: null, scores };
    }

    const confidence = Math.min(top[1] / Math.max(total, 1), 1);
    return {
      model:      top[0],
      icon:       MODEL_SIGNATURES[top[0]]?.icon,
      confidence: +confidence.toFixed(3),
      score:      top[1],
      scores
    };
  }

  /**
   * Master AI Detection Analysis
   * Returns AI likelihood score (0=human, 1=AI) with breakdown
   */
  analyze(text) {
    if (!text || text.length < 50) {
      return { error: 'Text too short', aiPercent: 0, verdict: 'Unknown', confidence: 'Low' };
    }

    const tokens = this.tokenize(text);
    const sentences = this.splitSentences(text);

    // Compute individual signals
    const burstiness      = this.computeBurstiness(sentences);
    const ttr             = this.computeTTR(tokens);
    const hapaxRatio      = this.computeHapaxRatio(tokens);
    const perplexity      = this.computePerplexityProxy(tokens);
    const transitionDens  = this.computeTransitionDensity(text, sentences);
    const wordLenStats    = this.computeWordLengthStats(tokens);
    const punctStats      = this.computePunctuationScore(text);
    const repetition      = this.computeStructuralRepetition(sentences);
    const aiPhrases       = this.detectAIPhrases(text);
    const gunningFogDeviation = this.computeGunningFog(sentences, tokens);

    // Advanced signals from reference repo
    const zipfScore            = this.computeZipfScore(tokens);
    const sentUniformityRatio  = this.computeSentenceUniformityRatio(sentences);
    const probabilityCurvature = this.computeProbabilityCurvatureProxy(tokens);
    const stylometric          = this.computeStylometricVariance(text);

    // Model signature
    const modelSignature = this.detectModelSignature(text);

    // --- AI likelihood signals (each 0-1, where 1 = more AI-like) ---
    const uniformSentLen  = 1 - burstiness;
    const lowHapax        = 1 - hapaxRatio;
    const highTransition  = transitionDens;
    const highPerplexity  = perplexity;
    const longWordBias    = Math.min(wordLenStats.longWordRatio / 0.25, 1);
    const phraseScore     = Math.min(aiPhrases.length / 2, 1);
    const repetitionScore = repetition;
    const uniformFog      = 1 - gunningFogDeviation;

    // Weighted AI score - tuned for modern LLMs with Fast-DetectGPT curvature
    const aiScore = (
      uniformSentLen             * 0.04 +
      lowHapax                   * 0.04 +
      highTransition             * 0.15 +
      highPerplexity             * 0.20 +
      phraseScore                * 0.10 +
      repetitionScore            * 0.05 +
      uniformFog                 * 0.05 +
      zipfScore                  * 0.05 +
      sentUniformityRatio        * 0.05 +
      probabilityCurvature.aiLikelihood * 0.27   // High weight for curvature proxy
    );

    const clampedScore = Math.min(Math.max(aiScore, 0), 1);

    // Boost score slightly if model signature was confidently matched
    const sigBoost = modelSignature.confidence > 0.4 ? modelSignature.confidence * 0.08 : 0;
    const finalScore = Math.min(clampedScore + sigBoost, 1);

    // Determine verdict
    let verdict, confidence, icon;
    if (finalScore >= 0.70) {
      verdict = 'Likely AI-Generated';
      confidence = 'High Confidence';
      icon = '🤖';
    } else if (finalScore >= 0.45) {
      verdict = 'Mixed / Uncertain';
      confidence = 'Medium Confidence';
      icon = '⚠️';
    } else if (finalScore >= 0.25) {
      verdict = 'Likely Human-Written';
      confidence = 'Medium Confidence';
      icon = '✍️';
    } else {
      verdict = 'Human-Written';
      confidence = 'High Confidence';
      icon = '👤';
    }

    return {
      aiScore:          +finalScore.toFixed(4),
      aiPercent:        Math.round(finalScore * 100),
      humanPercent:     Math.round((1 - finalScore) * 100),
      verdict,
      confidence,
      icon,
      modelSignature,
      stylometric,
      probabilityCurvature,
      signals: {
        sentenceLengthUniformity: +uniformSentLen.toFixed(3),
        burstiness:               +burstiness.toFixed(3),
        hapaxRatio:               +hapaxRatio.toFixed(3),
        lexicalDiversity:         +ttr.toFixed(3),
        transitionWordDensity:    +transitionDens.toFixed(3),
        longWordRatio:            +wordLenStats.longWordRatio.toFixed(3),
        avgWordLength:            wordLenStats.avg,
        structuralRepetition:     +repetitionScore.toFixed(3),
        readingLevelUniformity:   +uniformFog.toFixed(3),
        perplexityProxy:          +perplexity.toFixed(3),
        zipfDeviation:            +zipfScore.toFixed(3),
        sentenceUniformityRatio:  +sentUniformityRatio.toFixed(3)
      },
      foundAIPhrases:   aiPhrases,
      textStats: {
        wordCount:      tokens.length,
        sentenceCount:  sentences.length,
        avgSentLen:     +(tokens.length / (sentences.length || 1)).toFixed(1)
      }
    };
  }
}

(typeof window !== 'undefined' ? window : self).AIDetector = AIDetector;
