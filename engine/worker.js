importScripts('nlp-engine.js', 'fingerprint.js', 'lcs.js', 'ai-detector.js');

const nlp = new self.NLPEngine();
const aiDetector = new self.AIDetector();

self.onmessage = function(e) {
  const { id, action, payload } = e.data;
  
  try {
    let result;
    
    if (action === 'processSingle') {
      const { textA, textB, internetText, realSources } = payload;
      
      const stats = nlp.getTextStats(textA);
      
      self.postMessage({ type: 'progress', pct: 20, msg: 'Analyzing text statistics...' });
      const aiDetection = aiDetector.analyze(textA);
      
      self.postMessage({ type: 'progress', pct: 40, msg: 'Running AI detection models...' });
      
      let similarity = null;
      let sentenceMatches = [];
      let finalSources = realSources || [];
      
      const finalTextB = (textB + " " + (internetText || "")).trim();
      
      if (finalTextB.length > 50) {
        similarity = nlp.analyzeSimilarity(textA, finalTextB);
        self.postMessage({ type: 'progress', pct: 70, msg: 'Comparing similarity with sources...' });
        
        sentenceMatches = nlp.getSentenceMatches(textA, finalTextB);
        self.postMessage({ type: 'progress', pct: 90, msg: 'Matching individual sentences...' });
        
        // Distribution of internet score
        if (finalSources && finalSources.length > 0) {
          let rem = similarity.plagiarismPercent || 0;
          finalSources = finalSources.map((s, si) => {
            let score = 0;
            if (rem > 0) {
                score = si === finalSources.length - 1 ? rem : Math.floor(rem * (0.2 + Math.random() * 0.2)) + 1;
                rem = Math.max(rem - score, 0);
            } else {
                score = 0;
            }
            return { ...s, score };
          }).filter(s => s.score > 0).sort((a, b) => b.score - a.score);
        }
      }
      
      result = {
        stats,
        aiDetection,
        similarity,
        sentenceMatches,
        realSources: finalSources
      };
      
    } else if (action === 'processDoc') {
      // For bulk processing individual docs
      const { name, text, internetText, realSources } = payload;
      const finalTextB = internetText || '';
      
      const stats = nlp.getTextStats(text);
      const aiDetection = aiDetector.analyze(text);
      
      let similarity = { plagiarismPercent: 0, matchingPhrases: [] };
      let actualSources = [];
      let sentenceMatches = [];
      
      if (finalTextB && finalTextB.length > 30) {
        similarity = nlp.analyzeSimilarity(text, finalTextB);
        sentenceMatches = nlp.getSentenceMatches(text, finalTextB);
        actualSources = realSources || [];
        
        if (actualSources && actualSources.length > 0) {
          let rem = similarity.plagiarismPercent || 0;
          actualSources = actualSources.map((s, si) => {
            let score = 0;
            if (rem > 0) {
                score = si === actualSources.length - 1 ? rem : Math.floor(rem * (0.2 + Math.random() * 0.2)) + 1;
                rem = Math.max(rem - score, 0);
            } else {
                score = 0;
            }
            return { ...s, score };
          }).filter(s => s.score > 0).sort((a, b) => b.score - a.score);
        }
      }
      
      result = {
        name,
        text,
        stats,
        aiDetection,
        similarity,
        sentenceMatches,
        realSources: actualSources
      };
      
    } else if (action === 'computeCrossMatrix') {
      const { files } = payload;
      const similarPairs = [];
      
      let totalPairs = (files.length * (files.length - 1)) / 2;
      let completedPairs = 0;
      
      for (let i = 0; i < files.length; i++) {
        for (let j = i + 1; j < files.length; j++) {
          const sim = nlp.analyzeSimilarity(files[i].text, files[j].text);
          if (sim.plagiarismPercent > 20) {
            similarPairs.push({
              docA: files[i].name, docB: files[j].name,
              similarity: sim.combined, pct: sim.plagiarismPercent
            });
          }
          completedPairs++;
          // Send cross matrix progress (scaled between 85 and 100)
          const pct = 85 + (completedPairs / Math.max(totalPairs, 1)) * 15;
          self.postMessage({ type: 'progress', pct: pct, msg: `Cross-checking pairs (${completedPairs}/${totalPairs})...` });
        }
      }
      
      similarPairs.sort((a, b) => b.pct - a.pct);
      result = similarPairs;
      
    } else if (action === 'processAI') {
      const { text } = payload;
      result = aiDetector.analyze(text);
    }
    
    self.postMessage({ id, status: 'success', result });
    
  } catch (err) {
    self.postMessage({ id, status: 'error', error: err.message });
  }
};
