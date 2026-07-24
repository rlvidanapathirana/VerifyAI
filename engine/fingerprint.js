'use strict';
/**
 * VerifyAI Fingerprint Engine
 * Implements: Rabin-Karp Rolling Hash + Winnowing Algorithm
 * Used for near-duplicate and copy-paste detection
 */

class FingerprintEngine {
  constructor(kgramSize = 5, windowSize = 4) {
    this.k = kgramSize;      // size of each k-gram
    this.w = windowSize;     // sliding window for winnowing
    this.BASE = 101;
    this.MOD  = 1e9 + 7;
  }

  /**
   * Normalize text for fingerprinting
   */
  normalize(text) {
    return text
      .toLowerCase()
      .replace(/\s+/g, ' ')
      .replace(/[^a-z0-9 ]/g, '')
      .trim();
  }

  /**
   * Generate character-level k-grams from text
   */
  charKgrams(text) {
    const norm = this.normalize(text).replace(/\s/g, '');
    const grams = [];
    for (let i = 0; i <= norm.length - this.k; i++) {
      grams.push(norm.substring(i, i + this.k));
    }
    return grams;
  }

  /**
   * Rabin-Karp rolling hash for a k-gram string
   */
  rollingHash(kgram) {
    let hash = 0;
    for (let i = 0; i < kgram.length; i++) {
      hash = (hash * this.BASE + kgram.charCodeAt(i)) % this.MOD;
    }
    return hash;
  }

  /**
   * Compute hash values for all k-grams in text
   */
  computeHashes(text) {
    const grams = this.charKgrams(text);
    return grams.map(g => ({ gram: g, hash: this.rollingHash(g) }));
  }

  /**
   * Winnowing: select minimum hash in each sliding window
   * Returns the document fingerprint (set of selected hashes)
   */
  winnow(hashes) {
    const fingerprint = new Set();
    const selected = [];

    for (let i = 0; i <= hashes.length - this.w; i++) {
      const window = hashes.slice(i, i + this.w);
      let minHash = Infinity;
      let minGram = '';
      (typeof window !== 'undefined' ? window : self).forEach(({ hash, gram }) => {
        if (hash < minHash) { minHash = hash; minGram = gram; }
      });
      if (!fingerprint.has(minHash)) {
        fingerprint.add(minHash);
        selected.push({ hash: minHash, gram: minGram, position: i });
      }
    }

    return { fingerprint, selected };
  }

  /**
   * Generate document fingerprint
   */
  getFingerprint(text) {
    const hashes = this.computeHashes(text);
    if (hashes.length < this.w) {
      // Short text: use all hashes
      return {
        fingerprint: new Set(hashes.map(h => h.hash)),
        selected: hashes.map((h, i) => ({ ...h, position: i }))
      };
    }
    return this.winnow(hashes);
  }

  /**
   * Containment similarity: what fraction of A's fingerprint appears in B
   */
  containmentSimilarity(fpA, fpB) {
    let intersection = 0;
    fpA.fingerprint.forEach(h => {
      if (fpB.fingerprint.has(h)) intersection++;
    });
    const sizeA = fpA.fingerprint.size;
    return sizeA === 0 ? 0 : intersection / sizeA;
  }

  /**
   * Jaccard similarity between two fingerprints
   */
  jaccardSimilarity(fpA, fpB) {
    const setA = fpA.fingerprint;
    const setB = fpB.fingerprint;
    let intersection = 0;
    setA.forEach(h => { if (setB.has(h)) intersection++; });
    const union = setA.size + setB.size - intersection;
    return union === 0 ? 0 : intersection / union;
  }

  /**
   * Full fingerprint comparison between two texts
   */
  compare(textA, textB) {
    const fpA = this.getFingerprint(textA);
    const fpB = this.getFingerprint(textB);

    const jaccard = this.jaccardSimilarity(fpA, fpB);
    const containAinB = this.containmentSimilarity(fpA, fpB);
    const containBinA = this.containmentSimilarity(fpB, fpA);

    // Find matching k-grams (for highlighting)
    const matchingGrams = [];
    fpA.selected.forEach(({ hash, gram }) => {
      if (fpB.fingerprint.has(hash)) matchingGrams.push(gram);
    });

    return {
      jaccard:         +jaccard.toFixed(4),
      containmentAinB: +containAinB.toFixed(4),
      containmentBinA: +containBinA.toFixed(4),
      fingerprintSizeA: fpA.fingerprint.size,
      fingerprintSizeB: fpB.fingerprint.size,
      matchingGrams:   [...new Set(matchingGrams)].slice(0, 30)
    };
  }

  /**
   * Detect exact copy-paste blocks (high-confidence copied segments)
   * Returns matched n-gram phrases that are very likely copied
   */
  detectCopyPaste(textA, textB, minLength = 8) {
    const normA = this.normalize(textA).replace(/\s/g, '');
    const normB = this.normalize(textB).replace(/\s/g, '');
    const copied = [];

    // Use larger k-grams for copy-paste detection
    const savedK = this.k;
    this.k = minLength;
    const hashesA = this.computeHashes(textA);
    const hashesB = this.computeHashes(textB);
    this.k = savedK;

    const setB = new Set(hashesB.map(h => h.hash));
    hashesA.forEach(({ hash, gram }) => {
      if (setB.has(hash)) copied.push(gram);
    });

    return [...new Set(copied)];
  }
}

(typeof window !== 'undefined' ? window : self).FingerprintEngine = FingerprintEngine;
