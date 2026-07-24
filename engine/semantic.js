'use strict';
/**
 * VerifyAI Semantic Paraphrase Detection Engine
 * 
 * Detects PARAPHRASED plagiarism — the hardest type to catch.
 * Uses:
 *  1. Synonym substitution detection (built-in synonym dictionary)
 *  2. Character n-gram overlap (catches copy-editing, reordering)
 *  3. Sentence structure similarity (skip-gram comparison)
 *  4. Word order correlation (Spearman rank correlation)
 *  5. Semantic word cloud overlap
 */

// Built-in synonym dictionary for academic/common words
// Key = canonical form, Values = synonyms
const SYNONYM_MAP = {
  // Verbs
  'show': ['demonstrate','reveal','indicate','illustrate','display','exhibit','present','prove','establish'],
  'use': ['utilize','employ','apply','implement','adopt','leverage','exploit','harness'],
  'make': ['create','produce','generate','develop','build','construct','form','establish','achieve'],
  'help': ['assist','support','aid','facilitate','enable','allow','permit','foster'],
  'change': ['alter','modify','transform','shift','adjust','adapt','revise','update','vary'],
  'increase': ['grow','rise','expand','enhance','boost','improve','escalate','augment','elevate'],
  'decrease': ['reduce','decline','drop','fall','diminish','lessen','lower','shrink','curtail'],
  'find': ['discover','identify','detect','locate','determine','reveal','uncover','observe'],
  'study': ['examine','investigate','analyze','explore','research','evaluate','assess','review'],
  'discuss': ['address','examine','consider','explore','analyze','review','cover','explain'],
  'suggest': ['propose','recommend','indicate','imply','argue','claim','contend','submit'],
  'believe': ['think','consider','hold','maintain','argue','suggest','contend','assert','feel'],
  'cause': ['lead to','result in','produce','trigger','generate','induce','bring about','give rise to'],
  'need': ['require','demand','necessitate','call for','depend on'],
  'get': ['obtain','acquire','achieve','gain','receive','attain'],
  'look': ['appear','seem','observe','examine','consider'],
  'happen': ['occur','take place','arise','emerge','result','develop'],
  'provide': ['offer','supply','give','deliver','furnish','yield'],
  'include': ['contain','comprise','encompass','involve','incorporate','consist of'],
  'affect': ['impact','influence','alter','change','modify','shape','determine'],
  // Adjectives
  'important': ['significant','crucial','critical','essential','key','vital','fundamental','major','central'],
  'good': ['effective','beneficial','positive','favorable','advantageous','useful','valuable','excellent'],
  'bad': ['negative','harmful','detrimental','adverse','poor','ineffective','unfavorable','problematic'],
  'large': ['big','great','substantial','considerable','significant','extensive','major','enormous'],
  'small': ['little','minor','limited','minimal','slight','modest','low','reduced'],
  'new': ['novel','recent','modern','current','contemporary','emerging','innovative','latest'],
  'old': ['traditional','existing','previous','conventional','established','prior','historical','former'],
  'different': ['various','diverse','distinct','varied','alternative','other','multiple','separate'],
  'main': ['primary','principal','major','chief','central','key','core','dominant','leading'],
  'clear': ['obvious','evident','apparent','visible','explicit','plain','transparent','distinct'],
  'high': ['elevated','increased','greater','superior','advanced','strong','intense'],
  'low': ['reduced','decreased','limited','lesser','inferior','weak','minimal'],
  'many': ['numerous','various','several','multiple','diverse','a number of','countless'],
  'few': ['limited','some','a handful','several','a number of','not many'],
  // Nouns
  'study': ['research','investigation','analysis','examination','survey','review','assessment'],
  'result': ['outcome','finding','conclusion','effect','consequence','output','product'],
  'method': ['approach','technique','strategy','procedure','process','way','means','mechanism'],
  'problem': ['issue','challenge','concern','difficulty','obstacle','limitation','barrier'],
  'area': ['field','domain','region','sector','aspect','scope'],
  'group': ['population','set','collection','category','class','cluster','cohort'],
  'part': ['aspect','component','element','factor','dimension','section','portion','feature'],
  'way': ['manner','means','method','approach','process','mechanism','mode'],
  'work': ['research','study','effort','task','project','investigation'],
  'data': ['information','evidence','findings','results','statistics','figures'],
  'model': ['framework','system','approach','theory','structure','scheme'],
  'effect': ['impact','influence','consequence','outcome','result','significance'],
  'process': ['procedure','mechanism','method','operation','system','approach'],
  'level': ['degree','extent','amount','rate','measure'],
  'type': ['kind','form','category','class','variety','sort'],
  'role': ['function','purpose','contribution','part','significance'],
  'factor': ['aspect','element','variable','component','contributor','determinant'],
};

// Build reverse lookup: synonym -> canonical
const REVERSE_SYNONYM = {};
Object.entries(SYNONYM_MAP).forEach(([canonical, synonyms]) => {
  synonyms.forEach(syn => {
    REVERSE_SYNONYM[syn] = canonical;
    REVERSE_SYNONYM[syn.split(' ').join('_')] = canonical;
  });
  REVERSE_SYNONYM[canonical] = canonical;
});

class SemanticEngine {
  /**
   * Normalize a word to its canonical form (via synonym lookup)
   */
  normalize(word) {
    const w = word.toLowerCase().trim();
    return REVERSE_SYNONYM[w] || w;
  }

  /**
   * Tokenize and normalize (replace synonyms with canonical)
   */
  tokenizeNormalized(text) {
    return text
      .toLowerCase()
      .replace(/[^a-z\s]/g, ' ')
      .split(/\s+/)
      .filter(w => w.length > 2)
      .map(w => this.normalize(w));
  }

  /**
   * Character n-gram set from text
   */
  charNgrams(text, n = 4) {
    const clean = text.toLowerCase().replace(/\s+/g, ' ').replace(/[^a-z0-9 ]/g, '');
    const grams = new Set();
    for (let i = 0; i <= clean.length - n; i++) {
      grams.add(clean.substring(i, i + n));
    }
    return grams;
  }

  /**
   * Character n-gram Jaccard similarity
   */
  charNgramSimilarity(textA, textB, n = 4) {
    const setA = this.charNgrams(textA, n);
    const setB = this.charNgrams(textB, n);
    let intersection = 0;
    setA.forEach(g => { if (setB.has(g)) intersection++; });
    const union = setA.size + setB.size - intersection;
    return union === 0 ? 0 : intersection / union;
  }

  /**
   * Semantic word overlap: normalize synonyms then compute Jaccard
   */
  semanticOverlap(textA, textB) {
    const tokA = this.tokenizeNormalized(textA);
    const tokB = this.tokenizeNormalized(textB);
    const setA = new Set(tokA);
    const setB = new Set(tokB);
    let intersection = 0;
    setA.forEach(w => { if (setB.has(w)) intersection++; });
    const union = setA.size + setB.size - intersection;
    return union === 0 ? 0 : intersection / union;
  }

  /**
   * Detect synonym substitutions between two texts
   * Returns list of {original, synonym} pairs where the same meaning was used differently
   */
  detectSynonymSubstitutions(textA, textB) {
    const wordsA = textA.toLowerCase().replace(/[^a-z\s]/g, ' ').split(/\s+/).filter(w => w.length > 2);
    const wordsB = new Set(textB.toLowerCase().replace(/[^a-z\s]/g, ' ').split(/\s+/).filter(w => w.length > 2));
    const substitutions = [];
    const seen = new Set();

    wordsA.forEach(wA => {
      const canonical = REVERSE_SYNONYM[wA];
      if (!canonical) return;
      // Check if any synonym of wA appears in textB
      const synonyms = SYNONYM_MAP[canonical] || [];
      synonyms.forEach(syn => {
        const synWords = syn.split(' ');
        if (synWords.every(sw => wordsB.has(sw)) && wA !== syn) {
          const key = `${wA}->${syn}`;
          if (!seen.has(key)) {
            seen.add(key);
            substitutions.push({ original: wA, synonym: syn, canonical });
          }
        }
      });
    });

    return substitutions.slice(0, 20);
  }

  /**
   * Word order correlation (Spearman rank)
   * Detects if the same words appear in the same relative order
   */
  wordOrderCorrelation(textA, textB) {
    const tokA = this.tokenizeNormalized(textA);
    const tokB = this.tokenizeNormalized(textB);
    const commonWords = new Set(tokA.filter(w => tokB.includes(w)));
    if (commonWords.size < 4) return 0;

    const posA = {}, posB = {};
    let rankA = 0, rankB = 0;
    tokA.forEach((w, i) => { if (commonWords.has(w) && !(w in posA)) posA[w] = i; });
    tokB.forEach((w, i) => { if (commonWords.has(w) && !(w in posB)) posB[w] = i; });

    const pairs = [...commonWords].filter(w => w in posA && w in posB);
    if (pairs.length < 4) return 0;

    // Compute Spearman rank correlation
    const n = pairs.length;
    let dSquaredSum = 0;
    const sortedA = pairs.slice().sort((a, b) => posA[a] - posA[b]);
    const sortedB = pairs.slice().sort((a, b) => posB[a] - posB[b]);
    const rankAMap = {}, rankBMap = {};
    sortedA.forEach((w, i) => rankAMap[w] = i);
    sortedB.forEach((w, i) => rankBMap[w] = i);
    pairs.forEach(w => {
      const d = rankAMap[w] - rankBMap[w];
      dSquaredSum += d * d;
    });
    const spearman = 1 - (6 * dSquaredSum) / (n * (n * n - 1));
    return Math.max(0, Math.min(spearman, 1));
  }

  /**
   * Sentence-level semantic similarity using normalized tokens
   */
  sentenceSemanticSimilarity(sentA, sentB) {
    const tokA = this.tokenizeNormalized(sentA);
    const tokB = this.tokenizeNormalized(sentB);
    if (tokA.length === 0 || tokB.length === 0) return 0;

    const setA = new Set(tokA);
    const setB = new Set(tokB);
    let inter = 0;
    setA.forEach(w => { if (setB.has(w)) inter++; });
    const union = setA.size + setB.size - inter;
    return union === 0 ? 0 : inter / union;
  }

  /**
   * Full semantic analysis between two texts
   */
  analyze(textA, textB) {
    // Character n-gram similarities at multiple levels
    const char3 = this.charNgramSimilarity(textA, textB, 3);
    const char4 = this.charNgramSimilarity(textA, textB, 4);
    const char5 = this.charNgramSimilarity(textA, textB, 5);
    const charAvg = (char3 + char4 + char5) / 3;

    // Semantic word overlap (synonym-normalized)
    const semanticOverlap = this.semanticOverlap(textA, textB);

    // Word order correlation
    const orderCorr = this.wordOrderCorrelation(textA, textB);

    // Synonym substitutions
    const substitutions = this.detectSynonymSubstitutions(textA, textB);

    // Combined semantic similarity score
    // High char n-gram + high semantic overlap = likely paraphrase
    const paraphraseScore = Math.min(
      (charAvg * 0.35) + (semanticOverlap * 0.40) + (orderCorr * 0.25),
      1
    );

    // Paraphrase confidence
    let paraphraseVerdict;
    if (paraphraseScore >= 0.55) paraphraseVerdict = 'High Paraphrase Risk';
    else if (paraphraseScore >= 0.35) paraphraseVerdict = 'Moderate Paraphrase Risk';
    else paraphraseVerdict = 'Low Paraphrase Risk';

    return {
      charNgramSim: {
        trigram:  +char3.toFixed(4),
        fourgram: +char4.toFixed(4),
        fivegram: +char5.toFixed(4),
        average:  +charAvg.toFixed(4)
      },
      semanticOverlap:   +semanticOverlap.toFixed(4),
      wordOrderCorr:     +orderCorr.toFixed(4),
      paraphraseScore:   +paraphraseScore.toFixed(4),
      paraphrasePercent: Math.round(paraphraseScore * 100),
      paraphraseVerdict,
      synonymSubstitutions: substitutions
    };
  }

  /**
   * Get synonyms for a given word (for UI display)
   */
  getSynonyms(word) {
    const canonical = REVERSE_SYNONYM[word.toLowerCase()] || word.toLowerCase();
    return SYNONYM_MAP[canonical] || [];
  }
}

window.SemanticEngine = SemanticEngine;
