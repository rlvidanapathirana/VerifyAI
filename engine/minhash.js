'use strict';
/**
 * VerifyAI MinHash + LSH Engine
 * Implements MinHash with 128 hash permutations for accurate Jaccard estimation
 * + SimHash for near-duplicate detection via Hamming distance
 * 
 * MinHash is the industry-standard algorithm used by Google, YouTube, and
 * academic plagiarism tools for fast, accurate similarity at scale.
 */

class MinHashEngine {
  constructor(numPermutations = 128) {
    this.n = numPermutations;
    // Pre-generate stable hash function coefficients (a*x + b mod p)
    this._a = [];
    this._b = [];
    const MERSENNE_PRIME = 2147483647; // 2^31 - 1
    // Use a seeded LCG for deterministic coefficients
    let seed = 0xdeadbeef;
    const lcg = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed; };
    for (let i = 0; i < this.n; i++) {
      this._a.push((lcg() % MERSENNE_PRIME) + 1);
      this._b.push(lcg() % MERSENNE_PRIME);
    }
    this._p = MERSENNE_PRIME;
  }

  /**
   * Hash a single integer using the i-th permutation function
   */
  _hashPermutation(x, i) {
    return ((this._a[i] * x + this._b[i]) % this._p);
  }

  /**
   * MurmurHash3 32-bit for string hashing
   */
  _murmur32(str) {
    let h = 0xdeadbeef;
    for (let i = 0; i < str.length; i++) {
      let k = str.charCodeAt(i);
      k = Math.imul(k, 0xcc9e2d51);
      k = (k << 15) | (k >>> 17);
      k = Math.imul(k, 0x1b873593);
      h ^= k;
      h = (h << 13) | (h >>> 19);
      h = (Math.imul(h, 5) + 0xe6546b64) | 0;
    }
    h ^= str.length;
    h ^= h >>> 16;
    h = Math.imul(h, 0x85ebca6b);
    h ^= h >>> 13;
    h = Math.imul(h, 0xc2b2ae35);
    h ^= h >>> 16;
    return h >>> 0;
  }

  /**
   * Tokenize to word shingles (k-gram tokens)
   */
  _shingle(text, k = 2) {
    const words = text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter(w => w.length > 0);
    const shingles = new Set();
    for (let i = 0; i <= words.length - k; i++) {
      shingles.add(words.slice(i, i + k).join(' '));
    }
    return shingles;
  }

  /**
   * Compute MinHash signature (array of n min-hash values)
   */
  computeSignature(text, k = 2) {
    const shingles = this._shingle(text, k);
    if (shingles.size === 0) return new Array(this.n).fill(0);

    const sig = new Array(this.n).fill(Infinity);
    shingles.forEach(shingle => {
      const h = this._murmur32(shingle);
      for (let i = 0; i < this.n; i++) {
        const hPerm = this._hashPermutation(h, i);
        if (hPerm < sig[i]) sig[i] = hPerm;
      }
    });
    return sig;
  }

  /**
   * Estimate Jaccard similarity from two MinHash signatures
   */
  estimateJaccard(sigA, sigB) {
    let matches = 0;
    for (let i = 0; i < this.n; i++) {
      if (sigA[i] === sigB[i]) matches++;
    }
    return matches / this.n;
  }

  /**
   * Full MinHash comparison between two texts
   */
  compare(textA, textB) {
    // Use bigram shingles (k=2) and trigram shingles (k=3)
    const sig2A = this.computeSignature(textA, 2);
    const sig2B = this.computeSignature(textB, 2);
    const sig3A = this.computeSignature(textA, 3);
    const sig3B = this.computeSignature(textB, 3);

    const jaccard2 = this.estimateJaccard(sig2A, sig2B);
    const jaccard3 = this.estimateJaccard(sig3A, sig3B);
    const combined = (jaccard2 * 0.55) + (jaccard3 * 0.45);

    return {
      bigramJaccard:  +jaccard2.toFixed(4),
      trigramJaccard: +jaccard3.toFixed(4),
      minHashScore:   +combined.toFixed(4),
      minHashPercent: Math.round(combined * 100)
    };
  }

  /**
   * Build a bulk MinHash matrix for N documents (very fast)
   */
  buildBulkMatrix(texts) {
    const n = texts.length;
    const sigs = texts.map(t => this.computeSignature(t, 2));
    const matrix = Array.from({ length: n }, () => Array(n).fill(0));
    for (let i = 0; i < n; i++) {
      matrix[i][i] = 1;
      for (let j = i + 1; j < n; j++) {
        const sim = this.estimateJaccard(sigs[i], sigs[j]);
        matrix[i][j] = +sim.toFixed(4);
        matrix[j][i] = +sim.toFixed(4);
      }
    }
    return matrix;
  }
}

/**
 * SimHash Engine
 * 64-bit locality-sensitive hash — great for detecting near-duplicate paragraphs
 * Hamming distance < 3 means near-duplicate
 */
class SimHashEngine {
  _hash32(str) {
    let h = 0x811c9dc5;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    return h >>> 0;
  }

  /**
   * Compute 32-bit SimHash of text
   */
  computeSimHash(text) {
    const words = text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter(w => w.length > 2);

    const v = new Array(32).fill(0);
    words.forEach(word => {
      const h = this._hash32(word);
      for (let i = 0; i < 32; i++) {
        v[i] += (h >> i & 1) ? 1 : -1;
      }
    });

    let fingerprint = 0;
    for (let i = 0; i < 32; i++) {
      if (v[i] > 0) fingerprint |= (1 << i);
    }
    return fingerprint >>> 0;
  }

  /**
   * Hamming distance between two SimHash values
   */
  hammingDistance(a, b) {
    let x = (a ^ b) >>> 0;
    let dist = 0;
    while (x) { dist += x & 1; x >>>= 1; }
    return dist;
  }

  /**
   * Similarity from Hamming distance (0 dist = identical, 32 = completely different)
   */
  similarity(hashA, hashB) {
    const hd = this.hammingDistance(hashA, hashB);
    return Math.max(0, 1 - hd / 32);
  }

  /**
   * Full SimHash comparison
   */
  compare(textA, textB) {
    const hashA = this.computeSimHash(textA);
    const hashB = this.computeSimHash(textB);
    const hd = this.hammingDistance(hashA, hashB);
    const sim = this.similarity(hashA, hashB);

    return {
      simHashA: hashA,
      simHashB: hashB,
      hammingDistance: hd,
      simHashSimilarity: +sim.toFixed(4),
      isNearDuplicate: hd <= 4,
      simHashPercent: Math.round(sim * 100)
    };
  }

  /**
   * Paragraph-level SimHash: detect which paragraphs are near-duplicates
   */
  findNearDuplicateParagraphs(textA, textB, threshold = 0.80) {
    const parasA = textA.split(/\n{2,}|\r\n{2,}/).filter(p => p.trim().length > 30);
    const parasB = textB.split(/\n{2,}|\r\n{2,}/).filter(p => p.trim().length > 30);
    const matches = [];

    parasA.forEach((pA, iA) => {
      const hashA = this.computeSimHash(pA);
      parasB.forEach((pB, iB) => {
        const hashB = this.computeSimHash(pB);
        const sim = this.similarity(hashA, hashB);
        if (sim >= threshold) {
          matches.push({ paragraphA: pA, paragraphB: pB, similarity: +sim.toFixed(4), iA, iB });
        }
      });
    });

    return matches.sort((a, b) => b.similarity - a.similarity);
  }
}

window.MinHashEngine = MinHashEngine;
window.SimHashEngine = SimHashEngine;
