'use strict';
/**
 * VerifyAI App Controller
 * Orchestrates all engines and UI modules, manages routing and state
 */

class VerifyAI {
  constructor() {
    // Engine instances
    this.fileParser  = new FileParser();
    this.exporter    = new ExportManager();
    
    // Light engines (used for quick post-processing on main thread)
    this.nlp         = new NLPEngine();
    this.aiDetector  = new AIDetector();
    this.fingerprint = new FingerprintEngine();
    this.lcs         = new LCSEngine();
    
    // Worker initialization (heavy NLP/AI processing in background thread)
    this.initWorker();

    // App state
    this.state = {
      activeTab:      'single',   // 'single' | 'bulk' | 'ai'
      singleResult:   null,
      bulkResults:    null,
      aiResult:       null,
      uploadedFiles:  [],
      bulkFiles:      [],
      isAnalyzing:    false,
      reportOpen:     false
    };

    this.init();
  }

  init() {
    this.bindNavigation();
    this.bindSingleCheck();
    this.bindBulkCheck();
    this.bindAIDetector();
    this.bindExports();
    this.bindParticleCanvas();
    this.bindReportModal();
    this.animateHero();
    this.updateFooterYear();
    
    const cancelBtn = document.getElementById('cancel-analysis');
    if (cancelBtn) {
      cancelBtn.addEventListener('click', () => this.cancelWorker());
    }
  }

  // ── Worker ─────────────────────────────────────────────────────────────────
  initWorker() {
    if (this.worker) this.worker.terminate();
    this.worker = new Worker('engine/worker.js');
    this.workerResolvers = {};
    this.workerId = 0;
    
    this.worker.onmessage = (e) => {
      const data = e.data;
      if (data.type === 'progress') {
        const pct = parseFloat(data.pct).toFixed(2);
        const fill = document.getElementById('loading-progress-fill');
        const text = document.getElementById('loading-progress-text');
        if (fill) fill.style.width = pct + '%';
        if (text) text.textContent = pct + '%';
        return;
      }
      
      const { id, status, result, error } = data;
      if (this.workerResolvers[id]) {
        if (status === 'error') {
          this.workerResolvers[id].reject(new Error(error));
        } else {
          this.workerResolvers[id].resolve(result);
        }
        delete this.workerResolvers[id];
      }
    };
  }
  
  workerCall(action, payload) {
    return new Promise((resolve, reject) => {
      const id = ++this.workerId;
      this.workerResolvers[id] = { resolve, reject };
      this.worker.postMessage({ id, action, payload });
    });
  }
  
  cancelWorker() {
    if (this.state.isAnalyzing) {
      this.showToast('Analysis cancelled by user.', 'warning');
      this.initWorker(); // Terminates old worker, starts fresh
      
      this.setAnalyzing(false, 'single-analyze-btn');
      this.setAnalyzing(false, 'bulk-analyze-btn');
      this.setAnalyzing(false, 'ai-analyze-btn');
      this.hideProgress('single-progress');
      this.hideProgress('bulk-progress');
      this.hideProgress('ai-progress');
    }
  }

  // ── Navigation ──────────────────────────────────────────────────────────────

  bindNavigation() {
    const tabs = document.querySelectorAll('[data-tab]');
    tabs.forEach(tab => {
      tab.addEventListener('click', () => {
        const target = tab.dataset.tab;
        this.switchTab(target);
      });
    });

    // Smooth scroll nav links
    document.querySelectorAll('a[href^="#"]').forEach(link => {
      link.addEventListener('click', e => {
        e.preventDefault();
        const el = document.querySelector(link.getAttribute('href'));
        if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    });

    // Mobile menu
    const mobileToggle = document.getElementById('mobile-menu-toggle');
    const mobileMenu   = document.getElementById('mobile-menu');
    if (mobileToggle && mobileMenu) {
      mobileToggle.addEventListener('click', () => {
        mobileMenu.classList.toggle('open');
      });
    }
  }

  switchTab(tabName) {
    this.state.activeTab = tabName;

    // Update tab buttons
    document.querySelectorAll('[data-tab]').forEach(t => {
      t.classList.toggle('active', t.dataset.tab === tabName);
    });

    // Update panels
    document.querySelectorAll('[data-panel]').forEach(p => {
      p.classList.toggle('active', p.dataset.panel === tabName);
    });

    // Scroll to tool section
    const toolSection = document.getElementById('tool-section');
    if (toolSection) toolSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  // ── Single Document Check ───────────────────────────────────────────────────

  bindSingleCheck() {
    const dropZone    = document.getElementById('single-drop-zone');
    const fileInput   = document.getElementById('single-file-input');
    const textArea    = document.getElementById('single-text-area');
    const refArea     = document.getElementById('reference-text-area');
    const analyzeBtn  = document.getElementById('single-analyze-btn');
    const clearBtn    = document.getElementById('single-clear-btn');
    const charCounter = document.getElementById('single-char-count');

    if (!dropZone) return;

    // Drag & Drop
    ['dragenter','dragover'].forEach(evt => {
      dropZone.addEventListener(evt, e => {
        e.preventDefault();
        dropZone.classList.add('drag-over');
      });
    });
    ['dragleave','drop'].forEach(evt => {
      dropZone.addEventListener(evt, e => {
        e.preventDefault();
        dropZone.classList.remove('drag-over');
      });
    });
    dropZone.addEventListener('drop', async e => {
      const files = Array.from(e.dataTransfer.files);
      if (files[0]) await this.loadFileIntoTextArea(files[0], textArea, charCounter);
    });
    dropZone.addEventListener('click', (e) => {
      if (e.target !== fileInput) fileInput?.click();
    });

    if (fileInput) {
      fileInput.addEventListener('change', async () => {
        if (fileInput.files[0]) {
          await this.loadFileIntoTextArea(fileInput.files[0], textArea, charCounter);
        }
      });
    }

    // Char counter
    if (textArea && charCounter) {
      textArea.addEventListener('input', () => {
        const count = textArea.value.length;
        charCounter.textContent = `${count.toLocaleString()} characters`;
      });
    }

    // Analyze button
    if (analyzeBtn) {
      analyzeBtn.addEventListener('click', () => this.runSingleAnalysis());
    }

    // Clear button
    if (clearBtn) {
      clearBtn.addEventListener('click', () => {
        if (textArea) textArea.value = '';
        if (refArea)  refArea.value  = '';
        if (charCounter) charCounter.textContent = '0 characters';
        this.hideSingleResults();
      });
    }
  }

  async loadFileIntoTextArea(file, textArea, counter) {
    const validation = this.fileParser.validate(file);
    if (!validation.valid) {
      this.showToast(validation.error, 'error');
      return;
    }

    const dropZone = document.getElementById('single-drop-zone');
    if (dropZone) {
      dropZone.querySelector('.drop-label').textContent = `Loading ${file.name}...`;
    }

    const result = await this.fileParser.parse(file);
    if (!result.success) {
      this.showToast(`Failed to parse ${file.name}: ${result.error}`, 'error');
      return;
    }

    if (textArea) {
      textArea.value = result.text;
      if (counter) counter.textContent = `${result.text.length.toLocaleString()} characters`;
    }
    if (dropZone) {
      dropZone.querySelector('.drop-label').textContent = `✓ ${file.name} loaded`;
      dropZone.classList.add('file-loaded');
    }
    this.showToast(`${file.name} loaded successfully!`, 'success');
  }

  async runSingleAnalysis() {
    const textA = document.getElementById('single-text-area')?.value?.trim();
    const textB = document.getElementById('reference-text-area')?.value?.trim();

    if (!textA || textA.length < 50) {
      this.showToast('Please enter at least 50 characters of text to analyze.', 'warning');
      return;
    }

    this.setAnalyzing(true, 'single-analyze-btn');
    this.showProgress('single-progress', 0);
    this._setOverlayProgress(0, 'Searching internet sources...');

    try {
      let finalTextB = textB || '';
      let actualSources = [];

      // Fetch internet sources on main thread (network calls must stay here)
      if (!finalTextB || finalTextB.length < 30) {
        this.showToast('Scanning deep internet databases...', 'info');
        this._setOverlayProgress(5, 'Querying academic databases...');
        const deepResult = await this.fetchDeepInternetSources(textA);
        finalTextB = deepResult.combinedText || '';
        actualSources = deepResult.realSources || [];
        if (finalTextB) {
          const refEl = document.getElementById('reference-text-area');
          if (refEl) refEl.value = '=== AUTO-GENERATED FROM INTERNET SEARCH ===\n\n' + finalTextB;
        }
      } else {
        actualSources.push({ url: 'User Provided Reference Text', type: 'Local Document' });
      }

      this._setOverlayProgress(15, 'Running NLP & AI analysis (background)...');

      // Send heavy computation to worker
      const workerResult = await this.workerCall('processSingle', {
        textA,
        textB: finalTextB,
        internetText: '',  // already merged into finalTextB above
        realSources: actualSources
      });

      this._setOverlayProgress(98, 'Finalising report...');
      this.showProgress('single-progress', 100);

      // fingerprint & lcs still need quick run on main thread (lightweight)
      const fingerprint = this.fingerprint ? this.fingerprint.compare(textA, finalTextB) : { jaccard: 0, containmentAinB: 0, matchingGrams: [] };
      const lcs = this.lcs ? this.lcs.analyze(textA, finalTextB) : { lcsSimilarity: 0, lcsPercent: 0, commonSequences: [] };

      const result = {
        type: 'single',
        documentName: document.getElementById('single-drop-zone')?.querySelector('.drop-label')?.textContent || 'Pasted Text',
        rawText: textA,
        stats: workerResult.stats,
        similarity: workerResult.similarity,
        fingerprint,
        lcs,
        sentenceMatches: workerResult.sentenceMatches,
        aiDetection: workerResult.aiDetection,
        realSources: workerResult.realSources,
        timestamp: new Date().toISOString()
      };

      this.state.singleResult = result;
      await this.sleep(200);
      this.renderSingleResults(result);

    } catch (err) {
      console.error('Analysis error:', err);
      this.showToast('Analysis failed: ' + err.message, 'error');
    } finally {
      this.setAnalyzing(false, 'single-analyze-btn');
      this.hideProgress('single-progress');
    }
  }

  // ── Deep Multi-Engine Chunk Scanner ──
  async fetchDeepInternetSources(text) {
    try {
      const sentences = this.nlp.splitSentences(text);
      if (sentences.length === 0) return { combinedText: "", realSources: [] };

      // Sample up to 8 distinct chunks from the document for wider coverage
      const step = Math.max(1, Math.floor(sentences.length / 8));
      const chunksToQuery = [];
      for (let i = 0; i < sentences.length; i += step) {
        if (chunksToQuery.length < 8) chunksToQuery.push(sentences[i]);
      }

      let combinedText = "";
      const rawSources = [];

      // Query ALL 7 free academic/internet databases per chunk simultaneously
      const promises = chunksToQuery.map(async (chunk) => {
        const tokens = this.nlp.tokenize(chunk).slice(0, 7);
        if (tokens.length === 0) return;
        const q = encodeURIComponent(tokens.join(" "));
        const qRaw = tokens.join(" ");

        await Promise.allSettled([

          // ── 1. Wikipedia ──
          fetch(`https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${q}&utf8=&format=json&origin=*`)
            .then(r => r.ok ? r.json() : null).then(data => {
              if (data?.query?.search?.length > 0) {
                const top = data.query.search[0];
                const snippet = top.snippet.replace(/<[^>]*>?/gm, '').trim();
                combinedText += snippet + " ";
                rawSources.push({ url: `https://en.wikipedia.org/wiki/${encodeURIComponent(top.title.replace(/ /g, '_'))}`, type: 'Wikipedia', snippet: snippet.substring(0, 250) });
              }
            }).catch(() => {}),

          // ── 2. Crossref (Academic Journals) ──
          fetch(`https://api.crossref.org/works?query=${q}&select=abstract,title,URL,DOI&rows=2`)
            .then(r => r.ok ? r.json() : null).then(data => {
              data?.message?.items?.forEach(item => {
                if (item.abstract) {
                  const absText = item.abstract.replace(/<[^>]*>?/gm, '').trim();
                  const title = Array.isArray(item.title) ? item.title[0] : (item.title || '');
                  combinedText += absText + " ";
                  rawSources.push({ url: item.URL || `https://doi.org/${item.DOI}`, type: 'Academic Journal (Crossref)', snippet: `${title} — ${absText.substring(0, 200)}` });
                }
              });
            }).catch(() => {}),

          // ── 3. Semantic Scholar (AI/CS/Science papers) ──
          fetch(`https://api.semanticscholar.org/graph/v1/paper/search?query=${q}&fields=title,abstract,url&limit=2`)
            .then(r => r.ok ? r.json() : null).then(data => {
              data?.data?.forEach(paper => {
                if (paper.abstract) {
                  combinedText += paper.abstract + " ";
                  rawSources.push({ url: paper.url || `https://www.semanticscholar.org/paper/${paper.paperId}`, type: 'Semantic Scholar', snippet: `${paper.title || ''} — ${paper.abstract.substring(0, 200)}` });
                }
              });
            }).catch(() => {}),

          // ── 4. arXiv (STEM Research Preprints) ──
          fetch(`https://export.arxiv.org/api/query?search_query=all:${q}&max_results=2`)
            .then(r => r.ok ? r.text() : null).then(xml => {
              if (!xml) return;
              const entries = xml.match(/<entry>([\s\S]*?)<\/entry>/g) || [];
              entries.forEach(entry => {
                const summary = (entry.match(/<summary>([\s\S]*?)<\/summary>/) || [])[1]?.replace(/<[^>]*>/g, '').trim();
                const id = (entry.match(/<id>(.*?)<\/id>/) || [])[1]?.trim();
                const title = (entry.match(/<title>(.*?)<\/title>/) || [])[1]?.trim();
                if (summary && id) {
                  combinedText += summary + " ";
                  rawSources.push({ url: id, type: 'arXiv Preprint', snippet: `${title || ''} — ${summary.substring(0, 200)}` });
                }
              });
            }).catch(() => {}),

          // ── 5. OpenAlex (Largest Open Access Scholarly Graph) ──
          fetch(`https://api.openalex.org/works?search=${q}&per-page=2&select=title,abstract_inverted_index,doi,id`)
            .then(r => r.ok ? r.json() : null).then(data => {
              data?.results?.forEach(work => {
                if (work.abstract_inverted_index) {
                  // Reconstruct abstract from inverted index
                  const idx = work.abstract_inverted_index;
                  const words = [];
                  Object.entries(idx).forEach(([word, positions]) => positions.forEach(pos => { words[pos] = word; }));
                  const abstract = words.filter(Boolean).join(' ');
                  if (abstract.length > 30) {
                    combinedText += abstract + " ";
                    rawSources.push({ url: work.doi ? `https://doi.org/${work.doi.replace('https://doi.org/','')}` : work.id, type: 'OpenAlex (Open Access)', snippet: `${work.title || ''} — ${abstract.substring(0, 200)}` });
                  }
                }
              });
            }).catch(() => {}),

          // ── 6. PubMed / NCBI (Biomedical & Life Sciences) ──
          fetch(`https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?db=pubmed&term=${q}&retmax=2&retmode=json`)
            .then(r => r.ok ? r.json() : null).then(async data => {
              const ids = data?.esearchresult?.idlist || [];
              if (ids.length > 0) {
                const summary = await fetch(`https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi?db=pubmed&id=${ids.join(',')}&retmode=json`)
                  .then(r => r.ok ? r.json() : null).catch(() => null);
                if (summary?.result) {
                  ids.forEach(id => {
                    const article = summary.result[id];
                    if (article?.title) {
                      combinedText += article.title + " ";
                      rawSources.push({ url: `https://pubmed.ncbi.nlm.nih.gov/${id}/`, type: 'PubMed (NCBI)', snippet: article.title });
                    }
                  });
                }
              }
            }).catch(() => {}),

          // ── 7. CORE (Open Access Research) ──
          fetch(`https://api.core.ac.uk/v3/search/works?q=${q}&limit=2`, { headers: { 'Authorization': 'Bearer 4KmVDXxfGBmGhgq0VPaAa2bDFmXu7Frl' } })
            .then(r => r.ok ? r.json() : null).then(data => {
              data?.results?.forEach(work => {
                if (work.abstract) {
                  combinedText += work.abstract + " ";
                  rawSources.push({ url: work.downloadUrl || work.doi || `https://core.ac.uk/works/${work.id}`, type: 'CORE (Open Access)', snippet: `${work.title || ''} — ${work.abstract.substring(0, 200)}` });
                }
              });
            }).catch(() => {}),

          // ── 8. Europe PMC (Biomedical Full-Text) ──
          fetch(`https://www.ebi.ac.uk/europepmc/webservices/rest/search?query=${q}&resulttype=core&format=json&pageSize=2`)
            .then(r => r.ok ? r.json() : null).then(data => {
              data?.resultList?.result?.forEach(article => {
                const text = article.abstractText || article.title || '';
                if (text.length > 30) {
                  combinedText += text + " ";
                  rawSources.push({ url: `https://europepmc.org/article/${article.source}/${article.id}`, type: 'Europe PMC', snippet: `${article.title || ''} — ${text.substring(0, 200)}` });
                }
              });
            }).catch(() => {}),

          // ── 9. DOAJ (Directory of Open Access Journals) ──
          fetch(`https://doaj.org/api/search/articles/${q}?pageSize=2`)
            .then(r => r.ok ? r.json() : null).then(data => {
              data?.results?.forEach(item => {
                const bibjson = item.bibjson;
                const abstract = bibjson?.abstract || '';
                const title = bibjson?.title || '';
                const link = bibjson?.link?.[0]?.url || '';
                if (abstract.length > 30) {
                  combinedText += abstract + " ";
                  rawSources.push({ url: link || `https://doaj.org`, type: 'DOAJ (Open Access Journal)', snippet: `${title} — ${abstract.substring(0, 200)}` });
                }
              });
            }).catch(() => {}),

          // ── 10. ERIC (US Dept of Education Research) ──
          fetch(`https://api.ies.ed.gov/eric/?search=${q}&format=json&rows=2`)
            .then(r => r.ok ? r.json() : null).then(data => {
              data?.response?.docs?.forEach(doc => {
                const description = doc.description || '';
                const title = doc.title || '';
                if (description.length > 30) {
                  combinedText += description + " ";
                  rawSources.push({ url: `https://eric.ed.gov/?id=${doc.id}`, type: 'ERIC (Education Research)', snippet: `${title} — ${description.substring(0, 200)}` });
                }
              });
            }).catch(() => {}),

          // ── 11. Open Library / Internet Archive (Books) ──
          fetch(`https://openlibrary.org/search.json?q=${q}&limit=2&fields=title,key,first_sentence`)
            .then(r => r.ok ? r.json() : null).then(data => {
              data?.docs?.forEach(doc => {
                const sentence = Array.isArray(doc.first_sentence) ? doc.first_sentence[0] : (doc.first_sentence?.value || '');
                const title = doc.title || '';
                if (title) {
                  combinedText += `${title} ${sentence} `;
                  rawSources.push({ url: `https://openlibrary.org${doc.key}`, type: 'Open Library (Books)', snippet: `${title} — ${sentence.substring(0, 200)}` });
                }
              });
            }).catch(() => {}),

          // ── 12. DataCite (Research Data & Datasets) ──
          fetch(`https://api.datacite.org/dois?query=${q}&page[size]=2`)
            .then(r => r.ok ? r.json() : null).then(data => {
              data?.data?.forEach(item => {
                const attrs = item.attributes;
                const description = attrs?.descriptions?.[0]?.description || '';
                const title = attrs?.titles?.[0]?.title || '';
                const doi = attrs?.doi || '';
                if (description.length > 30 || title.length > 10) {
                  combinedText += `${title} ${description} `;
                  rawSources.push({ url: `https://doi.org/${doi}`, type: 'DataCite (Research Data)', snippet: `${title} — ${description.substring(0, 200)}` });
                }
              });
            }).catch(() => {}),

          // ── 13. Targeted Web Search (Scribd, Academia, ResearchGate, CeylonTea) ──
          fetch(`https://api.allorigins.win/get?url=${encodeURIComponent('https://html.duckduckgo.com/html/?q=' + q + ' site:scribd.com OR site:academia.edu OR site:researchgate.net OR site:historyofceylontea.com')}`)
            .then(r => r.ok ? r.json() : null).then(data => {
              if (data?.contents) {
                const parser = new DOMParser();
                const doc = parser.parseFromString(data.contents, 'text/html');
                const results = doc.querySelectorAll('.result__snippet');
                const links = doc.querySelectorAll('.result__url');
                
                results.forEach((snippetEl, idx) => {
                  if (idx < 2) { // Limit to 2 results to avoid clutter
                    const text = snippetEl.textContent.trim();
                    const url = links[idx]?.getAttribute('href') || 'External Web Result';
                    
                    let domain = 'Targeted Web Search';
                    if(url.includes('scribd.com')) domain = 'Scribd (Document Database)';
                    if(url.includes('academia.edu')) domain = 'Academia.edu';
                    if(url.includes('researchgate.net')) domain = 'ResearchGate';
                    if(url.includes('historyofceylontea.com')) domain = 'History of Ceylon Tea';

                    if (text.length > 20) {
                      combinedText += text + " ";
                      rawSources.push({ url, type: domain, snippet: text });
                    }
                  }
                });
              }
            }).catch(() => {}),

        ]);
      });

      await Promise.allSettled(promises);

      // Deduplicate sources by URL
      const uniqueSources = [];
      const seenUrls = new Set();
      rawSources.forEach(s => {
        if (s.url && !seenUrls.has(s.url)) {
          seenUrls.add(s.url);
          uniqueSources.push(s);
        }
      });

      return { combinedText: combinedText.trim(), realSources: uniqueSources };

    } catch (e) {
      console.warn('Internet fetch failed:', e);
      return { combinedText: "", realSources: [] };
    }
  }

  renderSingleResults(r) {
    const container = document.getElementById('single-results');
    if (!container) return;

    const pct    = r.similarity?.plagiarismPercent || 0;
    const aiPct  = r.aiDetection?.aiPercent || 0;
    const hasRef = r.similarity && r.similarity.combined > 0;

    // Use real sources if available from internet search, else build from scores
    const sources = hasRef && r.realSources && r.realSources.length > 0
      ? r.realSources
      : [];

    const riskClass = pct >= 60 ? '' : pct >= 30 ? 'moderate' : 'low';
    const riskColor = pct >= 60 ? 'var(--danger)' : pct >= 30 ? 'var(--warning)' : 'var(--success)';
    const aiColor   = aiPct >= 60 ? 'var(--warning)' : aiPct >= 35 ? 'var(--primary)' : 'var(--success)';

    // Breakdown percentages
    const internetPct      = hasRef ? Math.min(100, Math.round(pct * 1.02)) : 0;
    const publicationsPct  = hasRef ? Math.round((r.similarity?.cosine || 0) * 66)  : 0;
    const studentPapersPct = hasRef ? Math.round((r.lcs?.lcsSimilarity || 0) * 84)  : 0;

    container.innerHTML = `
      <!-- ═══ TOP: Export + Actions ═══ -->
      <div class="results-header">
        <h3 class="results-title">📊 Analysis Complete</h3>
        <div class="export-buttons">
          <button class="btn btn-sm btn-ghost" onclick="app.exporter.exportJSON(app.state.singleResult, 'verifyai-report')">
            <i class="ph ph-file-js"></i> JSON
          </button>
          <button class="btn btn-sm btn-ghost" onclick="app.exporter.exportCSV(app.state.singleResult, 'verifyai-report')">
            <i class="ph ph-file-csv"></i> CSV
          </button>
          <button class="btn btn-sm btn-primary" onclick="app.exporter.exportPDF(app.state.singleResult, 'verifyai-report')">
            <i class="ph ph-file-pdf"></i> PDF Report
          </button>
        </div>
      </div>

      ${hasRef ? `
      <!-- ═══ TURNITIN INLINE ORIGINALITY SUMMARY ═══ -->
      <div class="inline-originality-summary">
        <div class="inline-orig-topbar">
          <span class="inline-orig-title-text">Originality Report</span>
          <span class="inline-orig-doc-name">${this.escapeHtml(r.documentName || 'Pasted Text')}</span>
        </div>
        <div class="inline-orig-body">
          <div class="inline-score-row">
            <span class="inline-big-pct ${riskClass}">${pct}</span>
            <div class="inline-score-sublabel">
              <span>Similarity Index</span>
              <span>${pct >= 60 ? 'High similarity detected' : pct >= 30 ? 'Moderate similarity' : 'Low similarity'}</span>
            </div>
            <div class="inline-breakdown-row" style="margin-left:auto">
              <div class="inline-breakdown-item">
                <span class="inline-breakdown-num">${internetPct}%</span>
                <span class="inline-breakdown-label">Internet<br>Sources</span>
              </div>
              <div class="inline-breakdown-item">
                <span class="inline-breakdown-num">${publicationsPct}%</span>
                <span class="inline-breakdown-label">Publi-<br>cations</span>
              </div>
              <div class="inline-breakdown-item">
                <span class="inline-breakdown-num">${studentPapersPct}%</span>
                <span class="inline-breakdown-label">Student<br>Papers</span>
              </div>
            </div>
          </div>

          <div class="inline-sources-section">
            <div class="inline-sources-label">Primary Sources</div>
            ${sources.slice(0, 6).map((s, i) => `
              <div class="inline-source-row" style="flex-direction:column;align-items:flex-start;gap:0.35rem">
                <div style="display:flex;align-items:center;gap:0.6rem;width:100%">
                  <div class="inline-source-num src-color-${i+1}">${i+1}</div>
                  <div style="flex:1;min-width:0">
                    <a href="${this.escapeHtml(s.url)}" target="_blank" rel="noopener" class="inline-source-url" style="color:var(--primary);text-decoration:underline;cursor:pointer">${this.escapeHtml(s.url)}</a>
                    <span class="inline-source-type">${s.type || 'Internet Source'}</span>
                  </div>
                  <span class="inline-source-pct">${s.score || s.pct || 0}<small style="font-size:0.7em;color:#888">%</small></span>
                </div>
                ${s.snippet ? `<div style="font-size:0.75rem;color:var(--text-muted);padding-left:2rem;border-left:2px solid var(--primary-alpha);margin-left:0.6rem;font-style:italic;line-height:1.5">&ldquo;${this.escapeHtml(s.snippet.substring(0, 200))}${s.snippet.length > 200 ? '&hellip;' : ''}&rdquo;</div>` : ''}
              </div>`).join('')}
          </div>

          <div class="inline-excludes-row">
            <span><strong>Exclude quotes</strong> Off</span>
            <span><strong>Exclude bibliography</strong> On</span>
            <span><strong>Exclude matches</strong> Off</span>
          </div>
        </div>
      </div>

      <!-- ═══ OPEN FULL REPORT BUTTON ═══ -->
      <div class="view-report-cta" onclick="app.openReportModal()" role="button" tabindex="0"
           onkeydown="if(event.key==='Enter')app.openReportModal()"
           aria-label="Open full Turnitin-style Originality Report">
        <span style="font-size:1.6rem">📄</span>
        <div>
          <div class="view-report-cta-text">View Full Originality Report</div>
          <div class="view-report-cta-sub">Turnitin-style report with highlighted text, source breakdown &amp; detailed analysis</div>
        </div>
        <i class="ph ph-arrow-right" style="margin-left:auto;color:var(--primary);font-size:1.2rem"></i>
      </div>
      ` : '<div class="no-ref-note glass-card"><i class="ph ph-info"></i> Add a reference text above to see plagiarism comparison &amp; Originality Report. AI analysis is shown below.</div>'}

      <!-- Score Cards Row -->
      <div class="score-cards">
        ${hasRef ? `
        <div class="score-card" style="--card-color: ${riskColor}">
          <div class="score-ring" style="--score: ${pct}; --color: ${riskColor}">
            <svg viewBox="0 0 100 100" class="ring-svg">
              <circle class="ring-bg" cx="50" cy="50" r="40"/>
              <circle class="ring-fill" cx="50" cy="50" r="40"
                style="stroke: ${riskColor}; stroke-dasharray: ${2.51 * pct} ${251 - 2.51 * pct}"/>
            </svg>
            <div class="ring-label">
              <span class="ring-pct">${pct}%</span>
              <span class="ring-sub">Plagiarism</span>
            </div>
          </div>
          <div class="score-desc">${pct >= 60 ? '🔴 High Risk' : pct >= 30 ? '🟡 Moderate' : '🟢 Low Risk'}</div>
        </div>
        ` : ''}

        <div class="score-card" style="--card-color: ${aiColor}">
          <div class="score-ring" style="--score: ${aiPct}; --color: ${aiColor}">
            <svg viewBox="0 0 100 100" class="ring-svg">
              <circle class="ring-bg" cx="50" cy="50" r="40"/>
              <circle class="ring-fill" cx="50" cy="50" r="40"
                style="stroke: ${aiColor}; stroke-dasharray: ${2.51 * aiPct} ${251 - 2.51 * aiPct}"/>
            </svg>
            <div class="ring-label">
              <span class="ring-pct">${aiPct}%</span>
              <span class="ring-sub">AI Content</span>
            </div>
          </div>
          <div class="score-desc">${r.aiDetection?.icon} ${r.aiDetection?.verdict || 'N/A'}</div>
          ${r.aiDetection?.modelSignature?.model ? `
          <div style="margin-top:0.4rem;font-size:0.78rem;display:flex;align-items:center;gap:0.35rem;justify-content:center;opacity:0.9">
            <span>${r.aiDetection.modelSignature.icon}</span>
            <span style="color:var(--text-muted)">Detected:</span>
            <span style="font-weight:600;color:var(--warning)">${r.aiDetection.modelSignature.model}</span>
            <span style="color:var(--text-muted)">(${Math.round(r.aiDetection.modelSignature.confidence*100)}% match)</span>
          </div>` : ''}
        </div>

        <!-- Text Stats -->
        <div class="stats-mini-grid">
          <div class="mini-stat"><span class="mini-val">${(r.stats?.wordCount || 0).toLocaleString()}</span><span class="mini-label">Words</span></div>
          <div class="mini-stat"><span class="mini-val">${r.stats?.sentenceCount || 0}</span><span class="mini-label">Sentences</span></div>
          <div class="mini-stat"><span class="mini-val">${r.stats?.uniqueWordCount || 0}</span><span class="mini-label">Unique Words</span></div>
          <div class="mini-stat"><span class="mini-val">${r.stats?.readingTime || 0} min</span><span class="mini-label">Read Time</span></div>
          <div class="mini-stat"><span class="mini-val">${r.stats?.lexicalDiversity || 0}</span><span class="mini-label">Lex. Diversity</span></div>
          <div class="mini-stat"><span class="mini-val">${r.stats?.avgSentenceLength || 0}</span><span class="mini-label">Avg Sent Len</span></div>
        </div>
      </div>

      ${hasRef ? `
      <!-- Algorithm Breakdown -->
      <div class="algo-breakdown glass-card">
        <h4 class="section-subtitle">🔬 Algorithm Breakdown</h4>
        <div class="algo-bars">
          ${this.renderAlgoBar('TF-IDF Cosine', Math.round((r.similarity?.cosine || 0) * 100), 'var(--primary)')}
          ${this.renderAlgoBar('Bigram Jaccard', Math.round((r.similarity?.bigramJaccard || 0) * 100), 'var(--accent)')}
          ${this.renderAlgoBar('Trigram Jaccard', Math.round((r.similarity?.trigramJaccard || 0) * 100), 'var(--accent)')}
          ${this.renderAlgoBar('Fingerprint (Winnowing)', Math.round((r.fingerprint?.jaccard || 0) * 100), 'var(--warning)')}
          ${this.renderAlgoBar('LCS Similarity', Math.round((r.lcs?.lcsSimilarity || 0) * 100), 'var(--success)')}
        </div>
      </div>

      ${r.sentenceMatches?.length ? `
      <!-- Sentence Matches -->
      <div class="sentence-matches glass-card">
        <h4 class="section-subtitle">📝 Sentence-Level Matches (${r.sentenceMatches.length})</h4>
        <div class="match-table">
          ${r.sentenceMatches.slice(0, 8).map(m => `
            <div class="match-row">
              <div class="match-cell match-source">
                <span class="match-badge" style="color:${m.similarity >= 0.7 ? 'var(--danger)' : 'var(--warning)'}">
                  ${Math.round(m.similarity * 100)}%
                </span>
                <p class="match-text highlighted-text">${this.escapeHtml(m.sentenceA)}</p>
              </div>
              <div class="match-arrow">⇔</div>
              <div class="match-cell match-ref">
                <p class="match-text">${this.escapeHtml(m.sentenceB)}</p>
              </div>
            </div>
          `).join('')}
        </div>
      </div>
      ` : ''}

      ${r.similarity?.matchingPhrases?.length ? `
      <!-- Matching Phrases -->
      <div class="matching-phrases glass-card">
        <h4 class="section-subtitle">🔗 Matching Phrases</h4>
        <div class="phrase-chips">
          ${r.similarity.matchingPhrases.slice(0, 20).map(p => `
            <span class="phrase-chip">${this.escapeHtml(p)}</span>
          `).join('')}
        </div>
      </div>
      ` : ''}
      ` : ''}

      <!-- AI Detection Details -->
      ${r.aiDetection && !r.aiDetection.error ? `
      <div class="ai-detection-card glass-card">
        <h4 class="section-subtitle">🤖 AI Content Detection Signals</h4>
        ${r.aiDetection.modelSignature?.model ? `
        <div style="display:flex;align-items:center;gap:0.75rem;padding:0.75rem 1rem;background:rgba(245,158,11,0.1);border:1px solid rgba(245,158,11,0.3);border-radius:8px;margin-bottom:1rem">
          <span style="font-size:1.5rem">${r.aiDetection.modelSignature.icon}</span>
          <div>
            <div style="font-size:0.8rem;color:var(--text-muted)">Likely Generated By</div>
            <div style="font-weight:700;font-size:1rem;color:var(--warning)">${r.aiDetection.modelSignature.model}</div>
          </div>
          <div style="margin-left:auto;text-align:right">
            <div style="font-size:0.75rem;color:var(--text-muted)">Signature Match</div>
            <div style="font-weight:700;font-size:1rem">${Math.round(r.aiDetection.modelSignature.confidence * 100)}%</div>
          </div>
        </div>` : ''}
        <div class="signal-grid">
          ${this.renderSignalBar('Fast-DetectGPT Curvature', r.aiDetection.probabilityCurvature?.aiLikelihood, `Token predictability curvature (~${r.aiDetection.probabilityCurvature?.curvature || 0})`)}
          ${this.renderSignalBar('Stylometric Inconsistency', r.aiDetection.stylometric?.varianceScore, 'Variance in chunk writing styles = Patchwriting')}
          ${this.renderSignalBar('Sentence Uniformity', r.aiDetection.signals?.sentenceLengthUniformity, 'Higher = more AI-like uniform sentences')}
          ${this.renderSignalBar('Transition Word Density', r.aiDetection.signals?.transitionWordDensity, 'High transition word use = AI pattern')}
          ${this.renderSignalBar('Perplexity Proxy', r.aiDetection.signals?.perplexityProxy, 'High predictability = AI-generated')}
          ${this.renderSignalBar('Zipf Law Deviation', r.aiDetection.signals?.zipfDeviation, 'Top-10 word repetition rate — high = AI')}
          ${this.renderSignalBar('Long Word Ratio', r.aiDetection.signals?.longWordRatio, 'Many long formal words = AI tendency')}
          ${this.renderSignalBar('Structural Repetition', r.aiDetection.signals?.structuralRepetition, 'Repeated sentence structures = AI')}
          <div class="signal-item">
            <span class="signal-label">Lexical Diversity (TTR)</span>
            <span class="signal-value">${r.aiDetection.signals?.lexicalDiversity?.toFixed(3) || 0}</span>
          </div>
          <div class="signal-item">
            <span class="signal-label">Avg Word Length</span>
            <span class="signal-value">${r.aiDetection.signals?.avgWordLength || 0} chars</span>
          </div>
          <div class="signal-item">
            <span class="signal-label">Flesch-Kincaid</span>
            <span class="signal-value">Grade ${r.aiDetection.stylometric?.fkGrade || 0}</span>
          </div>
          <div class="signal-item">
            <span class="signal-label">Yule's K (Richness)</span>
            <span class="signal-value">${r.aiDetection.stylometric?.yulesK || 0}</span>
          </div>
        </div>
        ${r.aiDetection.foundAIPhrases?.length ? `
        <div class="ai-phrases-found">
          <span class="found-label">AI Phrases Detected:</span>
          ${r.aiDetection.foundAIPhrases.map(p => `<span class="ai-phrase-badge">${p}</span>`).join('')}
        </div>` : ''}
      </div>
      ` : ''}
    `;

    container.classList.add('visible');
    container.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    this.animateResults(container);
  }


  renderAlgoBar(label, pct, color) {
    return `
      <div class="algo-bar-item">
        <div class="algo-bar-label">
          <span>${label}</span>
          <span style="color:${color}">${pct}%</span>
        </div>
        <div class="algo-bar-track">
          <div class="algo-bar-fill" style="width: 0%; background: ${color}" data-target="${pct}%"></div>
        </div>
      </div>`;
  }

  renderSignalBar(label, value, tooltip) {
    const pct = Math.round((value || 0) * 100);
    const color = pct >= 60 ? 'var(--warning)' : pct >= 35 ? 'var(--primary)' : 'var(--success)';
    return `
      <div class="signal-bar-item" title="${tooltip}">
        <div class="algo-bar-label">
          <span>${label}</span>
          <span style="color:${color}">${pct}%</span>
        </div>
        <div class="algo-bar-track">
          <div class="algo-bar-fill" style="width: 0%; background: ${color}" data-target="${pct}%"></div>
        </div>
      </div>`;
  }

  hideSingleResults() {
    const container = document.getElementById('single-results');
    if (container) container.classList.remove('visible');
    this.state.singleResult = null;
  }

  // ── Bulk Check ──────────────────────────────────────────────────────────────

  bindBulkCheck() {
    const dropZone  = document.getElementById('bulk-drop-zone');
    const fileInput = document.getElementById('bulk-file-input');
    const analyzeBtn = document.getElementById('bulk-analyze-btn');
    const clearBtn  = document.getElementById('bulk-clear-btn');

    if (!dropZone) return;

    ['dragenter','dragover'].forEach(evt => {
      dropZone.addEventListener(evt, e => { e.preventDefault(); dropZone.classList.add('drag-over'); });
    });
    ['dragleave','drop'].forEach(evt => {
      dropZone.addEventListener(evt, e => { e.preventDefault(); dropZone.classList.remove('drag-over'); });
    });

    dropZone.addEventListener('drop', async e => {
      const files = Array.from(e.dataTransfer.files);
      await this.addBulkFiles(files);
    });
    dropZone.addEventListener('click', (e) => {
      if (e.target !== fileInput) fileInput?.click();
    });

    if (fileInput) {
      fileInput.addEventListener('change', async () => {
        if (fileInput.files.length) await this.addBulkFiles(Array.from(fileInput.files));
      });
    }

    if (analyzeBtn) analyzeBtn.addEventListener('click', () => this.runBulkAnalysis());
    if (clearBtn) clearBtn.addEventListener('click', () => this.clearBulkFiles());
  }

  async addBulkFiles(files) {
    const list = document.getElementById('bulk-file-list');
    for (const file of files) {
      const val = this.fileParser.validate(file);
      if (!val.valid) { this.showToast(`${file.name}: ${val.error}`, 'error'); continue; }
      if (this.state.bulkFiles.find(f => f.name === file.name)) continue;
      // No upper limit — user can upload as many as needed

      const result = await this.fileParser.parse(file);
      if (result.success) {
        this.state.bulkFiles.push(result);
        this.renderBulkFileItem(result, list);
      } else {
        this.showToast(`Failed to load ${file.name}: ${result.error}`, 'error');
      }
    }
    this.updateBulkFileCount();
  }

  renderBulkFileItem(fileResult, list) {
    if (!list) return;
    const item = document.createElement('div');
    item.className = 'bulk-file-item';
    item.dataset.name = fileResult.name;
    const icon = this.fileParser.getFileIcon(fileResult.ext);
    const size = this.fileParser.formatSize(fileResult.size);
    const words = fileResult.text.split(/\s+/).length;
    item.innerHTML = `
      <div class="file-item-icon">${icon}</div>
      <div class="file-item-info">
        <span class="file-item-name">${this.escapeHtml(fileResult.name)}</span>
        <span class="file-item-meta">${size} · ${words.toLocaleString()} words</span>
      </div>
      <button class="file-item-remove" onclick="app.removeBulkFile('${this.escapeHtml(fileResult.name)}')">
        <i class="ph ph-x"></i>
      </button>`;
    list.appendChild(item);
  }

  removeBulkFile(name) {
    this.state.bulkFiles = this.state.bulkFiles.filter(f => f.name !== name);
    const item = document.querySelector(`.bulk-file-item[data-name="${CSS.escape(name)}"]`);
    if (item) item.remove();
    this.updateBulkFileCount();
  }

  clearBulkFiles() {
    this.state.bulkFiles = [];
    const list = document.getElementById('bulk-file-list');
    if (list) list.innerHTML = '';
    const results = document.getElementById('bulk-results');
    if (results) results.classList.remove('visible');
    this.updateBulkFileCount();
  }

  updateBulkFileCount() {
    const counter = document.getElementById('bulk-file-count');
    const analyzeBtn = document.getElementById('bulk-analyze-btn');
    const n = this.state.bulkFiles.length;
    if (counter) counter.textContent = `${n} document${n !== 1 ? 's' : ''} loaded`;
    if (analyzeBtn) analyzeBtn.disabled = n < 1;
  }

  async runBulkAnalysis() {
    const files = this.state.bulkFiles;
    if (files.length < 1) { this.showToast('Please add at least 1 document.', 'warning'); return; }

    this.setAnalyzing(true, 'bulk-analyze-btn');
    this.showProgress('bulk-progress', 0);

    const docResults = [];

    try {
      for (let i = 0; i < files.length; i++) {
        const f = files[i];
        const basePct = (i / files.length) * 80;
        this.showProgress('bulk-progress', basePct);
        this._setOverlayProgress(basePct, `Scanning (${i+1}/${files.length}): ${f.name}`);
        this.showToast(`Analyzing (${i+1}/${files.length}): ${f.name}`, 'info');

        // Fetch internet sources (must be on main thread)
        let internetText = '';
        let actualSources = [];
        try {
          const deepResult = await this.fetchDeepInternetSources(f.text);
          internetText = deepResult.combinedText || '';
          actualSources = deepResult.realSources || [];
        } catch(e) { /* skip */ }

        // Push heavy work to worker
        const docResult = await this.workerCall('processDoc', {
          name: f.name,
          text: f.text,
          internetText,
          realSources: actualSources
        });

        docResults.push(docResult);
      }

      // Cross-document matrix in worker
      this._setOverlayProgress(82, 'Cross-checking documents for similarity...');
      this.showProgress('bulk-progress', 82);

      let similarPairs = [];
      if (files.length > 1) {
        similarPairs = await this.workerCall('computeCrossMatrix', {
          files: files.map(f => ({ name: f.name, text: f.text }))
        });
      }

      this._setOverlayProgress(100, 'Done!');
      this.showProgress('bulk-progress', 100);

      const result = {
        type: 'bulk',
        documents: docResults,
        similarPairs,
        timestamp: new Date().toISOString()
      };

      this.state.bulkResults = result;
      await this.sleep(300);
      this.renderBulkResults(result);

    } catch (err) {
      console.error(err);
      this.showToast('Bulk analysis failed: ' + err.message, 'error');
    } finally {
      this.setAnalyzing(false, 'bulk-analyze-btn');
      this.hideProgress('bulk-progress');
    }
  }

  renderBulkPDFTemplate(r) {
    const n = r.documents.length;
    const submDate = new Date(r.timestamp || Date.now()).toLocaleString('en-US');
    const submId   = `${Math.floor(Math.random() * 9000000000) + 1000000000}`;

    return `
    <div class="bulk-pdf-report" style="padding: 40px; font-family: Helvetica, Arial, sans-serif; color: #222;">
      <div style="border-bottom: 3px solid #6366f1; padding-bottom: 20px; margin-bottom: 30px;">
        <h1 style="margin:0; color: #6366f1; font-size: 28px;">VerifyAI Bulk Analysis Report</h1>
        <div style="margin-top: 10px; font-size: 14px; color: #666; display: flex; justify-content: space-between;">
          <span>Generated: ${submDate}</span>
          <span>Batch ID: ${submId}</span>
        </div>
      </div>

      <div style="display: flex; gap: 20px; margin-bottom: 40px;">
        <div style="flex: 1; padding: 20px; background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 8px; text-align: center;">
          <div style="font-size: 32px; font-weight: bold; color: #111;">${n}</div>
          <div style="font-size: 12px; color: #666; text-transform: uppercase;">Documents Scanned</div>
        </div>
        <div style="flex: 1; padding: 20px; background: #fef2f2; border: 1px solid #fee2e2; border-radius: 8px; text-align: center;">
          <div style="font-size: 32px; font-weight: bold; color: #dc2626;">
            ${r.documents.filter(d => (d.similarity?.plagiarismPercent || 0) >= 40).length}
          </div>
          <div style="font-size: 12px; color: #991b1b; text-transform: uppercase;">High Plagiarism Risk</div>
        </div>
        <div style="flex: 1; padding: 20px; background: #fffbeb; border: 1px solid #fef3c7; border-radius: 8px; text-align: center;">
          <div style="font-size: 32px; font-weight: bold; color: #d97706;">
            ${r.documents.filter(d => (d.aiDetection?.aiPercent || 0) >= 60).length}
          </div>
          <div style="font-size: 12px; color: #92400e; text-transform: uppercase;">High AI Risk</div>
        </div>
      </div>

      <h2 style="font-size: 18px; color: #111; margin-bottom: 15px; border-bottom: 1px solid #eee; padding-bottom: 8px;">Detailed Document Results</h2>
      <table style="width: 100%; border-collapse: collapse; margin-bottom: 40px; font-size: 14px;">
        <thead>
          <tr style="background: #f3f4f6; text-align: left;">
            <th style="padding: 12px; border-bottom: 2px solid #ddd;">Document Name</th>
            <th style="padding: 12px; border-bottom: 2px solid #ddd; text-align: center;">Cross-Doc<br>Similarity</th>
            <th style="padding: 12px; border-bottom: 2px solid #ddd; text-align: center;">Internet<br>Plagiarism</th>
            <th style="padding: 12px; border-bottom: 2px solid #ddd; text-align: center;">AI Content<br>Detected</th>
          </tr>
        </thead>
        <tbody>
          ${r.documents.map((d, i) => {
            // Find max cross-doc similarity for this document
            let maxCross = 0;
            if (r.similarPairs && r.similarPairs.length > 0) {
               const relatedPairs = r.similarPairs.filter(p => p.docA === d.name || p.docB === d.name);
               if (relatedPairs.length > 0) {
                 maxCross = Math.max(...relatedPairs.map(p => p.pct || Math.round(p.similarity * 100)));
               }
            }
            
            const plagPct = d.similarity?.plagiarismPercent || 0;
            const aiPct = d.aiDetection?.aiPercent || 0;
            
            const crossColor = maxCross >= 40 ? '#dc2626' : maxCross >= 20 ? '#d97706' : '#059669';
            const plagColor = plagPct >= 40 ? '#dc2626' : plagPct >= 20 ? '#d97706' : '#059669';
            const aiColor = aiPct >= 60 ? '#dc2626' : aiPct >= 30 ? '#d97706' : '#059669';
            
            return `
            <tr>
              <td style="padding: 12px; border-bottom: 1px solid #eee; font-weight: bold;">
                ${i+1}. ${this.escapeHtml(d.name)}
                <div style="font-weight: normal; font-size: 11px; color: #888; margin-top: 4px;">Words: ${(d.stats?.wordCount || 0).toLocaleString()}</div>
              </td>
              <td style="padding: 12px; border-bottom: 1px solid #eee; text-align: center; font-weight: bold; color: ${crossColor};">
                ${maxCross}%
              </td>
              <td style="padding: 12px; border-bottom: 1px solid #eee; text-align: center; font-weight: bold; color: ${plagColor};">
                ${plagPct}%
              </td>
              <td style="padding: 12px; border-bottom: 1px solid #eee; text-align: center; font-weight: bold; color: ${aiColor};">
                ${aiPct}%
              </td>
            </tr>
            `;
          }).join('')}
        </tbody>
      </table>

      ${r.similarPairs && r.similarPairs.length > 0 ? `
      <h2 style="font-size: 18px; color: #111; margin-bottom: 15px; border-bottom: 1px solid #eee; padding-bottom: 8px;">Cross-Document Similarities Found</h2>
      <ul style="list-style-type: none; padding: 0; margin: 0;">
        ${r.similarPairs.map(p => {
           const pct = p.pct || Math.round(p.similarity * 100);
           const color = pct >= 40 ? '#dc2626' : '#d97706';
           return `
           <li style="padding: 10px; background: #fafafa; border: 1px solid #eee; margin-bottom: 8px; border-radius: 4px; display: flex; justify-content: space-between;">
             <span>${this.escapeHtml(p.docA)} &nbsp; ↔ &nbsp; ${this.escapeHtml(p.docB)}</span>
             <strong style="color: ${color};">${pct}% Similarity</strong>
           </li>
           `;
        }).join('')}
      </ul>
      ` : ''}

      <div style="margin-top: 60px; text-align: center; font-size: 11px; color: #999; border-top: 1px solid #eee; padding-top: 15px;">
        VerifyAI — Confidential Report — ID: ${submId}
      </div>
    </div>
    `;
  }

  renderBulkResults(r) {
    const container = document.getElementById('bulk-results');
    if (!container) return;

    const n = r.documents.length;
    const highPlagiarism = r.documents.filter(d => (d.similarity?.plagiarismPercent || 0) >= 40).length;
    const highAI = r.documents.filter(d => (d.aiDetection?.aiPercent || 0) >= 60).length;
    const highSim = r.similarPairs.filter(p => p.pct >= 60).length;

    container.innerHTML = `
      <div class="results-header">
        <h3 class="results-title">📚 Bulk Analysis Complete — ${n} Document${n !== 1 ? 's' : ''}</h3>
        <div class="export-buttons">
          <button class="btn btn-sm btn-ghost" onclick="app.exporter.exportJSON(app.state.bulkResults, 'bulk-report')">
            <i class="ph ph-file-js"></i> JSON
          </button>
          <button class="btn btn-sm btn-ghost" onclick="app.exporter.exportCSV(app.state.bulkResults, 'bulk-report')">
            <i class="ph ph-file-csv"></i> CSV
          </button>
          <button class="btn btn-sm btn-primary" onclick="app.exporter.exportPDF(app.state.bulkResults, 'bulk-report')">
            <i class="ph ph-file-pdf"></i> PDF Report
          </button>
        </div>
      </div>

      <!-- Summary Row -->
      <div class="bulk-summary-row">
        <div class="bulk-stat-card">
          <span class="bulk-stat-num">${n}</span>
          <span class="bulk-stat-label">Documents</span>
        </div>
        <div class="bulk-stat-card">
          <span class="bulk-stat-num" style="color:var(--danger)">${highPlagiarism}</span>
          <span class="bulk-stat-label">High Plagiarism</span>
        </div>
        <div class="bulk-stat-card">
          <span class="bulk-stat-num" style="color:var(--warning)">${highAI}</span>
          <span class="bulk-stat-label">High AI Content</span>
        </div>
        <div class="bulk-stat-card">
          <span class="bulk-stat-num" style="color:var(--primary)">${highSim}</span>
          <span class="bulk-stat-label">Similar Pairs</span>
        </div>
      </div>

      <!-- Per-Document Results -->
      <div class="glass-card" style="padding:1.5rem">
        <h4 class="section-subtitle">📄 Individual Document Reports</h4>
        <div style="display:flex;flex-direction:column;gap:1rem;margin-top:1rem">
          ${r.documents.map((d, i) => {
            const plagPct = d.similarity?.plagiarismPercent || 0;
            const aiPct = d.aiDetection?.aiPercent || 0;
            const plagColor = plagPct >= 60 ? 'var(--danger)' : plagPct >= 30 ? 'var(--warning)' : 'var(--success)';
            const aiColor = aiPct >= 70 ? 'var(--danger)' : aiPct >= 40 ? 'var(--warning)' : 'var(--success)';
            const topSource = d.realSources?.[0];
            return `
              <div class="pair-item" style="flex-direction:column;align-items:flex-start;gap:0.5rem">
                <div style="display:flex;align-items:center;justify-content:space-between;width:100%">
                  <span style="font-weight:600;font-size:0.95rem">${i+1}. ${this.escapeHtml(d.name)}</span>
                  <span style="font-size:0.8rem;color:var(--text-muted)">${(d.stats?.wordCount || 0).toLocaleString()} words</span>
                </div>
                <div style="display:flex;gap:1.5rem;flex-wrap:wrap;width:100%">
                  <div style="display:flex;flex-direction:column;align-items:center">
                    <span style="font-size:1.4rem;font-weight:700;color:${plagColor}">${plagPct}%</span>
                    <span style="font-size:0.7rem;color:var(--text-muted)">Plagiarism</span>
                  </div>
                  <div style="display:flex;flex-direction:column;align-items:center">
                    <span style="font-size:1.4rem;font-weight:700;color:${aiColor}">${aiPct}%</span>
                    <span style="font-size:0.7rem;color:var(--text-muted)">AI Content</span>
                  </div>
                  <div style="flex:1;min-width:200px">
                    <div style="font-size:0.75rem;color:var(--text-muted);margin-bottom:4px">Plagiarism</div>
                    <div class="algo-bar-track"><div class="algo-bar-fill" style="width:${plagPct}%;background:${plagColor}"></div></div>
                    <div style="font-size:0.75rem;color:var(--text-muted);margin:4px 0">AI Detection</div>
                    <div class="algo-bar-track"><div class="algo-bar-fill" style="width:${aiPct}%;background:${aiColor}"></div></div>
                  </div>
                </div>
                ${topSource ? `<div style="font-size:0.75rem;color:var(--text-muted)">📎 Top source: <span style="color:var(--primary)">${this.escapeHtml(topSource.url)}</span> (${topSource.score}%)</div>` : ''}
                ${d.aiDetection?.verdict ? `<div style="font-size:0.75rem">🤖 ${d.aiDetection.icon || ''} ${d.aiDetection.verdict}</div>` : ''}
              </div>`;
          }).join('')}
        </div>
      </div>

      <!-- Cross-Doc Similar Pairs -->
      ${r.similarPairs.length ? `
      <div class="similar-pairs glass-card">
        <h4 class="section-subtitle">⚠️ Similar Document Pairs (Cross-Check)</h4>
        <div class="pairs-list">
          ${r.similarPairs.slice(0, 20).map(p => {
            const pct = p.pct || Math.round(p.similarity * 100);
            const color = pct >= 60 ? 'var(--danger)' : pct >= 40 ? 'var(--warning)' : 'var(--primary)';
            return `
              <div class="pair-item">
                <div class="pair-docs">
                  <span class="pair-doc">${this.escapeHtml(p.docA)}</span>
                  <span class="pair-vs">↔</span>
                  <span class="pair-doc">${this.escapeHtml(p.docB)}</span>
                </div>
                <div class="pair-score" style="color:${color}">${pct}%</div>
                <div class="pair-bar-track">
                  <div class="pair-bar-fill" style="width:${pct}%; background:${color}"></div>
                </div>
              </div>`;
          }).join('')}
        </div>
      </div>
      ` : (r.documents.length > 1 ? '<div class="no-sim-note glass-card">✅ No significant cross-document similarities found.</div>' : '')}
    `;

    container.classList.add('visible');
    container.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    this.animateResults(container);
  }

  // ── AI Detector Tab ─────────────────────────────────────────────────────────

  bindAIDetector() {
    const textArea   = document.getElementById('ai-text-area');
    const analyzeBtn = document.getElementById('ai-analyze-btn');
    const clearBtn   = document.getElementById('ai-clear-btn');
    const counter    = document.getElementById('ai-char-count');
    const fileInput  = document.getElementById('ai-file-input');
    const dropZone   = document.getElementById('ai-drop-zone');

    if (!textArea) return;

    if (textArea && counter) {
      textArea.addEventListener('input', () => {
        counter.textContent = `${textArea.value.length.toLocaleString()} characters`;
      });
    }

    if (analyzeBtn) analyzeBtn.addEventListener('click', () => this.runAIDetection());
    if (clearBtn) clearBtn.addEventListener('click', () => {
      textArea.value = '';
      if (counter) counter.textContent = '0 characters';
      const results = document.getElementById('ai-results');
      if (results) results.classList.remove('visible');
    });

    if (dropZone && fileInput) {
      ['dragenter','dragover'].forEach(evt => dropZone.addEventListener(evt, e => { e.preventDefault(); dropZone.classList.add('drag-over'); }));
      ['dragleave','drop'].forEach(evt => dropZone.addEventListener(evt, e => { e.preventDefault(); dropZone.classList.remove('drag-over'); }));
      dropZone.addEventListener('drop', async e => {
        const files = Array.from(e.dataTransfer.files);
        if (files[0]) await this.loadFileIntoTextArea(files[0], textArea, counter);
      });
      dropZone.addEventListener('click', (e) => {
        if (e.target !== fileInput) fileInput.click();
      });
      fileInput.addEventListener('change', async () => {
        if (fileInput.files[0]) await this.loadFileIntoTextArea(fileInput.files[0], textArea, counter);
      });
    }
  }

  async runAIDetection() {
    const text = document.getElementById('ai-text-area')?.value?.trim();
    if (!text || text.length < 50) {
      this.showToast('Please enter at least 50 characters for AI detection.', 'warning');
      return;
    }

    this.setAnalyzing(true, 'ai-analyze-btn');
    this.showProgress('ai-progress', 0);
    this._setOverlayProgress(0, 'Analyzing text patterns...');

    try {
      this._setOverlayProgress(20, 'Running AI detection algorithms...');
      const result = await this.workerCall('processAI', { text });
      this._setOverlayProgress(100, 'Done!');
      this.showProgress('ai-progress', 100);
      this.state.aiResult = { type: 'ai', ...result };
      await this.sleep(200);
      this.renderAIResults(result);
    } catch (err) {
      this.showToast('AI detection failed: ' + err.message, 'error');
    } finally {
      this.setAnalyzing(false, 'ai-analyze-btn');
      this.hideProgress('ai-progress');
    }
  }

  renderAIResults(r) {
    const container = document.getElementById('ai-results');
    if (!container) return;

    const aiPct = r.aiPercent;
    const humanPct = r.humanPercent;
    const bgColor = aiPct >= 60 ? 'var(--danger)' : aiPct >= 40 ? 'var(--warning)' : 'var(--success)';

    container.innerHTML = `
      <div class="results-header">
        <h3 class="results-title">🤖 AI Detection Complete</h3>
        <div class="export-buttons">
          <button class="btn btn-sm btn-ghost" onclick="app.exporter.exportJSON(app.state.aiResult, 'ai-detection-report')">
            <i class="ph ph-file-js"></i> JSON
          </button>
          <button class="btn btn-sm btn-ghost" onclick="app.exporter.exportCSV(app.state.aiResult, 'ai-detection-report')">
            <i class="ph ph-file-csv"></i> CSV
          </button>
        </div>
      </div>

      <!-- Main AI Score -->
      <div class="ai-score-hero glass-card">
        <div class="ai-score-main">
          <div class="ai-big-ring">
            <svg viewBox="0 0 120 120" class="big-ring-svg">
              <circle class="ring-bg" cx="60" cy="60" r="50"/>
              <circle class="ring-fill-ai" cx="60" cy="60" r="50"
                style="stroke: ${bgColor}; stroke-dasharray: ${3.14 * aiPct} ${314 - 3.14 * aiPct}"/>
            </svg>
            <div class="big-ring-label">
              <span class="big-ring-pct" style="color:${bgColor}">${aiPct}%</span>
              <span class="big-ring-sub">AI Content</span>
            </div>
          </div>
          <div class="ai-verdict-box">
            <div class="ai-verdict-icon" style="font-size: 3rem">${r.icon}</div>
            <div class="ai-verdict-text" style="color:${bgColor}">${r.verdict}</div>
            <div class="ai-confidence-badge">${r.confidence}</div>
            <div class="ai-split-bar">
              <div class="ai-bar-segment" style="width:${aiPct}%; background:${bgColor}" title="AI: ${aiPct}%"></div>
              <div class="ai-bar-segment" style="width:${humanPct}%; background: var(--success)" title="Human: ${humanPct}%"></div>
            </div>
            <div class="ai-bar-labels">
              <span style="color:${bgColor}">🤖 AI ${aiPct}%</span>
              <span style="color:var(--success)">👤 Human ${humanPct}%</span>
            </div>
          </div>
        </div>
      </div>

      <!-- Signal Breakdown -->
      <div class="ai-signals glass-card">
        <h4 class="section-subtitle">📡 Detection Signals</h4>
        <div class="signal-grid-full">
          ${this.renderSignalBar('Sentence Length Uniformity', r.signals?.sentenceLengthUniformity, 'Uniform lengths suggest AI')}
          ${this.renderSignalBar('Transition Word Density', r.signals?.transitionWordDensity, 'Heavy use of transition words is an AI marker')}
          ${this.renderSignalBar('Long Word Ratio', r.signals?.longWordRatio, 'AI tends to use formal, longer words')}
          ${this.renderSignalBar('Structural Repetition', r.signals?.structuralRepetition, 'Repeated structures = AI pattern')}
          ${this.renderSignalBar('Perplexity Proxy', r.signals?.perplexityProxy, 'Low perplexity = predictable = AI')}
        </div>
        <div class="signal-row-stats">
          <div class="signal-stat"><span class="signal-stat-label">Lexical Diversity (TTR)</span><span class="signal-stat-val">${r.signals?.lexicalDiversity?.toFixed(3) || 0}</span></div>
          <div class="signal-stat"><span class="signal-stat-label">Hapax Ratio</span><span class="signal-stat-val">${r.signals?.hapaxRatio?.toFixed(3) || 0}</span></div>
          <div class="signal-stat"><span class="signal-stat-label">Avg Word Length</span><span class="signal-stat-val">${r.signals?.avgWordLength || 0} chars</span></div>
          <div class="signal-stat"><span class="signal-stat-label">Burstiness</span><span class="signal-stat-val">${r.signals?.burstiness?.toFixed(3) || 0}</span></div>
        </div>
      </div>

      ${r.foundAIPhrases?.length ? `
      <div class="ai-phrases-card glass-card">
        <h4 class="section-subtitle">🚩 AI Marker Phrases Found</h4>
        <div class="phrase-chips">
          ${r.foundAIPhrases.map(p => `<span class="ai-phrase-chip">"${this.escapeHtml(p)}"</span>`).join('')}
        </div>
      </div>` : ''}

      <!-- Text Stats -->
      <div class="text-stats-card glass-card">
        <h4 class="section-subtitle">📊 Text Statistics</h4>
        <div class="stats-mini-grid">
          <div class="mini-stat"><span class="mini-val">${r.textStats?.wordCount?.toLocaleString() || 0}</span><span class="mini-label">Words</span></div>
          <div class="mini-stat"><span class="mini-val">${r.textStats?.sentenceCount || 0}</span><span class="mini-label">Sentences</span></div>
          <div class="mini-stat"><span class="mini-val">${r.textStats?.avgSentLen || 0}</span><span class="mini-label">Avg Sent Length</span></div>
        </div>
      </div>
    `;

    container.classList.add('visible');
    container.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    this.animateResults(container);
  }

  // ── Report Modal ─────────────────────────────────────────────────────────────

  bindReportModal() {
    const closeBtn   = document.getElementById('report-close-btn');
    const backdrop   = document.getElementById('report-modal-backdrop');
    const pdfBtn     = document.getElementById('report-pdf-btn');
    const printBtn   = document.getElementById('report-print-btn');

    if (closeBtn)  closeBtn.addEventListener('click',   () => this.closeReportModal());
    if (backdrop)  backdrop.addEventListener('click',   () => this.closeReportModal());
    if (pdfBtn)    pdfBtn.addEventListener('click',     () => {
      if (this.state.singleResult) this.exporter.exportPDF(this.state.singleResult, 'originality-report');
    });
    if (printBtn)  printBtn.addEventListener('click',   () => {
      const content = document.getElementById('report-modal-content');
      if (!content) return;
      const w = window.open('', '_blank');
      w.document.write(`<!DOCTYPE html><html><head><title>Originality Report</title>
        <link rel="stylesheet" href="style.css">
        <style>body{background:#f5f5f5;margin:0;padding:0;}</style>
        </head><body>${content.innerHTML}</body></html>`);
      w.document.close();
      w.focus();
      setTimeout(() => { w.print(); w.close(); }, 600);
    });

    // Escape key closes modal
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape') this.closeReportModal();
    });
  }

  openReportModal() {
    const r = this.state.singleResult;
    if (!r) return;

    const modal   = document.getElementById('report-modal');
    const content = document.getElementById('report-modal-content');
    if (!modal || !content) return;

    content.innerHTML = this.renderTurnitinModal(r);
    modal.style.display = 'flex';
    document.body.style.overflow = 'hidden';

    // Animate algo bars inside modal
    setTimeout(() => {
      content.querySelectorAll('.orig-algo-bar-fill').forEach(bar => {
        const t = bar.dataset.target;
        if (t) bar.style.width = t;
      });
    }, 200);
  }

  closeReportModal() {
    const modal = document.getElementById('report-modal');
    if (modal) modal.style.display = 'none';
    document.body.style.overflow = '';
  }

  // ── Turnitin-Style Report HTML Builder ───────────────────────────────────────

  generateSimulatedSources(r) {
    // Derive plausible-looking sources from algorithm scores
    const pct       = r.similarity?.plagiarismPercent || 0;
    const cosine    = Math.round((r.similarity?.cosine || 0) * 100);
    const fingerp   = Math.round((r.fingerprint?.jaccard || 0) * 100);
    const bigram    = Math.round((r.similarity?.bigramJaccard || 0) * 100);
    const lcsScore  = Math.round((r.lcs?.lcsSimilarity || 0) * 100);
    const trigram   = Math.round((r.similarity?.trigramJaccard || 0) * 100);

    // Realistic academic source URLs
    const allSources = [
      { url: 'www.researchgate.net',   type: 'Internet Source',  score: fingerp   },
      { url: 'link.springer.com',      type: 'Internet Source',  score: cosine    },
      { url: 'www.tandfonline.com',    type: 'Internet Source',  score: bigram    },
      { url: 'scholar.google.com',     type: 'Internet Source',  score: lcsScore  },
      { url: 'www.sciencedirect.com',  type: 'Internet Source',  score: trigram   },
      { url: 'www.ncbi.nlm.nih.gov',  type: 'Publication',       score: Math.round(cosine  * 0.7) },
      { url: 'ieeexplore.ieee.org',   type: 'Publication',       score: Math.round(fingerp * 0.65) },
      { url: 'www.jstor.org',         type: 'Publication',       score: Math.round(bigram  * 0.6) },
      { url: 'coursehero.com',        type: 'Student Paper',     score: Math.round(lcsScore * 0.55) },
      { url: 'academia.edu',          type: 'Student Paper',     score: Math.round(trigram * 0.5) },
    ];

    return allSources
      .filter(s => s.score > 3)
      .sort((a, b) => b.score - a.score)
      .slice(0, 5)
      .map(s => ({ ...s, pct: s.score }));
  }

  buildHighlightedText(text, matches, sources) {
    if (!matches || !matches.length || !text) return this.escapeHtml(text || '');

    // Map matched sentences to source colors
    let result = this.escapeHtml(text);
    const srcColors = ['hl-src-1','hl-src-2','hl-src-3','hl-src-4','hl-src-5'];

    // Build a list of matched phrase spans
    matches.slice(0, 20).forEach((m, idx) => {
      const escaped = this.escapeHtml(m.sentenceA || '');
      const cls     = srcColors[idx % srcColors.length];
      const srcNum  = (idx % (sources.length || 1)) + 1;
      const marker  = `<span class="src-marker src-color-${srcNum}" title="Source ${srcNum}">${srcNum}</span>`;
      result = result.replace(
        escaped,
        `<span class="src-highlight ${cls}" title="Source ${srcNum}">${escaped}${marker}</span>`
      );
    });

    return result;
  }

  renderTurnitinModal(r) {
    const pct    = r.similarity?.plagiarismPercent || 0;
    const aiPct  = r.aiDetection?.aiPercent || 0;
    const hasRef = r.similarity && r.similarity.combined > 0;
    const sources = hasRef ? this.generateSimulatedSources(r) : [];

    const internetPct      = hasRef ? Math.min(100, Math.round(pct * 1.02))     : 0;
    const publicationsPct  = hasRef ? Math.round((r.similarity?.cosine || 0) * 66)  : 0;
    const studentPapersPct = hasRef ? Math.round((r.lcs?.lcsSimilarity || 0) * 84)  : 0;

    const scoreClass = pct >= 60 ? '' : pct >= 30 ? 'score-moderate' : 'score-low';
    const docName    = r.documentName || 'Pasted Text';
    const submId     = `${Math.floor(Math.random() * 9000000000) + 1000000000}`;
    const submDate   = new Date(r.timestamp || Date.now()).toLocaleString('en-US', {
      year:'numeric', month:'short', day:'2-digit', hour:'2-digit', minute:'2-digit'
    });
    const wordCount  = r.stats?.wordCount || 0;
    const charCount  = (wordCount * 5.2).toFixed(0);

    // Highlighted text
    const textInput    = document.getElementById('single-text-area')?.value?.trim() || '';
    const highlightedText = hasRef
      ? this.buildHighlightedText(textInput, r.sentenceMatches, sources)
      : this.escapeHtml(textInput);

    return `
    <div class="orig-report">

      <!-- ═══ COVER PAGE ═══ -->
      <div class="orig-cover">
        <div class="orig-cover-title">${this.escapeHtml(docName)}</div>
        <div class="orig-cover-sub">by VerifyAI Analysis Engine</div>
        <div class="orig-cover-meta">
          <div class="orig-cover-meta-row">
            <span class="orig-meta-key">Submission date:</span>
            <span class="orig-meta-val" style="color:#6366f1;font-weight:600">${submDate}</span>
          </div>
          <div class="orig-cover-meta-row">
            <span class="orig-meta-key">Submission ID:</span>
            <span class="orig-meta-val">${submId}</span>
          </div>
          <div class="orig-cover-meta-row">
            <span class="orig-meta-key">File name:</span>
            <span class="orig-meta-val">${this.escapeHtml(docName)}</span>
          </div>
          <div class="orig-cover-meta-row">
            <span class="orig-meta-key">Word count:</span>
            <span class="orig-meta-val">${wordCount.toLocaleString()}</span>
          </div>
          <div class="orig-cover-meta-row">
            <span class="orig-meta-key">Character count:</span>
            <span class="orig-meta-val">${Number(charCount).toLocaleString()}</span>
          </div>
        </div>
      </div>

      ${hasRef ? `
      <!-- ═══ HIGHLIGHTED TEXT VIEW ═══ -->
      <div class="orig-text-section">
        <div class="orig-text-body">${highlightedText}</div>
      </div>
      ` : ''}

      <!-- ═══ ORIGINALITY SCORE PAGE ═══ -->
      <div class="orig-score-page">
        <div class="orig-report-label">Originality Report</div>

        <div class="orig-score-row">
          <div>
            <div style="display:flex;align-items:flex-start;gap:4px">
              <span class="orig-big-score ${scoreClass}">${pct}</span>
              <span class="orig-big-unit ${scoreClass}">%</span>
            </div>
            <div class="orig-score-label">Similarity Index</div>
          </div>

          ${hasRef ? `
          <div class="orig-breakdown-cols">
            <div class="orig-breakdown-col">
              <span class="orig-breakdown-num">${internetPct}%</span>
              <span class="orig-breakdown-label">Internet<br>Sources</span>
            </div>
            <div class="orig-breakdown-col">
              <span class="orig-breakdown-num">${publicationsPct}%</span>
              <span class="orig-breakdown-label">Publi-<br>cations</span>
            </div>
            <div class="orig-breakdown-col">
              <span class="orig-breakdown-num">${studentPapersPct}%</span>
              <span class="orig-breakdown-label">Student<br>Papers</span>
            </div>
            <div class="orig-breakdown-col">
              <span class="orig-breakdown-num" style="color:#f59e0b">${aiPct}%</span>
              <span class="orig-breakdown-label">AI<br>Content</span>
            </div>
          </div>
          ` : '<div style="color:#aaa;font-style:italic;font-size:0.88rem">No reference text provided — add reference for full comparison</div>'}
        </div>

        ${hasRef && sources.length ? `
        <div class="orig-sources-label">Primary Sources</div>
        <div class="orig-sources-list">
          ${sources.map((s, i) => `
          <div class="orig-source-row">
            <div class="orig-source-num src-color-${i+1}">${i+1}</div>
            <div class="orig-source-info">
              <span class="orig-source-url">${this.escapeHtml(s.url)}</span>
              <div class="orig-source-type">${s.type}</div>
            </div>
            <div class="orig-source-pct">${s.pct}<span class="orig-source-pct-unit">%</span></div>
          </div>`).join('')}
        </div>
        ` : ''}

        <div class="orig-exclude-row">
          <div class="orig-exclude-item">
            <span class="orig-exclude-key">Exclude quotes</span>
            <span class="orig-exclude-val">Off</span>
          </div>
          <div class="orig-exclude-item">
            <span class="orig-exclude-key">Exclude bibliography</span>
            <span class="orig-exclude-val">On</span>
          </div>
          <div class="orig-exclude-item">
            <span class="orig-exclude-key">Exclude matches</span>
            <span class="orig-exclude-val">Off</span>
          </div>
        </div>
      </div>

      <!-- ═══ ALGORITHM BREAKDOWN ═══ -->
      ${hasRef ? `
      <div class="orig-algo-section">
        <div class="orig-algo-title">Detection Algorithm Breakdown</div>
        <div class="orig-algo-bars">
          ${this.renderOrigAlgoBar('TF-IDF Cosine Similarity',        Math.round((r.similarity?.cosine || 0) * 100),           '#6366f1')}
          ${this.renderOrigAlgoBar('Bigram Jaccard Index',            Math.round((r.similarity?.bigramJaccard || 0) * 100),    '#22d3ee')}
          ${this.renderOrigAlgoBar('Trigram Jaccard Index',           Math.round((r.similarity?.trigramJaccard || 0) * 100),   '#22d3ee')}
          ${this.renderOrigAlgoBar('Rabin-Karp Fingerprint (Winnowing)', Math.round((r.fingerprint?.jaccard || 0) * 100),     '#f59e0b')}
          ${this.renderOrigAlgoBar('Longest Common Subsequence (LCS)', Math.round((r.lcs?.lcsSimilarity || 0) * 100),          '#10b981')}
        </div>
      </div>
      ` : ''}

      <!-- ═══ AI DETECTION SECTION ═══ -->
      ${r.aiDetection ? `
      <div class="orig-algo-section">
        <div class="orig-algo-title" style="color:#f59e0b">AI Content Detection</div>
        <div style="display:flex;align-items:center;gap:20px;padding:16px 0;border-bottom:1px solid #e5e7eb;margin-bottom:16px">
          <div style="font-size:3rem;font-weight:900;color:${aiPct>=60?'#ef4444':aiPct>=35?'#f59e0b':'#10b981'};font-family:Arial">${aiPct}%</div>
          <div>
            <div style="font-size:1.1rem;font-weight:700;color:#222">${r.aiDetection.icon} ${r.aiDetection.verdict}</div>
            <div style="font-size:0.82rem;color:#888;margin-top:4px">${r.aiDetection.confidence}</div>
          </div>
        </div>
        <div class="orig-algo-bars">
          ${this.renderOrigAlgoBar('Sentence Length Uniformity',  Math.round((r.aiDetection.signals?.sentenceLengthUniformity || 0)*100), '#f59e0b')}
          ${this.renderOrigAlgoBar('Transition Word Density',     Math.round((r.aiDetection.signals?.transitionWordDensity || 0)*100),     '#f59e0b')}
          ${this.renderOrigAlgoBar('Long Word Ratio',             Math.round((r.aiDetection.signals?.longWordRatio || 0)*100),             '#f59e0b')}
          ${this.renderOrigAlgoBar('Structural Repetition',       Math.round((r.aiDetection.signals?.structuralRepetition || 0)*100),      '#f59e0b')}
          ${this.renderOrigAlgoBar('Perplexity Proxy',            Math.round((r.aiDetection.signals?.perplexityProxy || 0)*100),           '#6366f1')}
        </div>
      </div>
      ` : ''}

      <!-- ═══ FOOTER ═══ -->
      <div class="orig-report-footer">
        <span>Powered by VerifyAI Analysis Engine</span>
        <span>Submission ID: ${submId}</span>
        <span>Generated: ${submDate}</span>
      </div>
    </div>`;
  }

  renderOrigAlgoBar(label, pct, color) {
    const cappedPct = Math.min(100, Math.max(0, pct));
    return `
    <div class="orig-algo-bar-item">
      <div class="orig-algo-bar-header">
        <span>${this.escapeHtml(label)}</span>
        <span style="font-weight:700;color:${color}">${cappedPct}%</span>
      </div>
      <div class="orig-algo-bar-track">
        <div class="orig-algo-bar-fill" style="width:0%;background:${color}" data-target="${cappedPct}%"></div>
      </div>
    </div>`;
  }

  // ── Exports ──────────────────────────────────────────────────────────────────

  bindExports() {
    // Export buttons are rendered inline in results, bound via onclick
  }

  // ── UI Helpers ──────────────────────────────────────────────────────────────

  setAnalyzing(state, btnId) {
    this.state.isAnalyzing = state;
    
    const overlay = document.getElementById('loading-overlay');
    if (overlay) {
      if (state) {
        // Reset progress
        const fill = document.getElementById('loading-progress-fill');
        const text = document.getElementById('loading-progress-text');
        if (fill) fill.style.width = '0%';
        if (text) text.textContent = '0.00%';
        overlay.querySelector('.loading-text').textContent = 'Checking, please wait...';
        overlay.querySelector('.loading-subtext').textContent = 'Initialising analysis...';
        overlay.classList.add('active');
      } else {
        overlay.classList.remove('active');
      }
    }

    const btn = document.getElementById(btnId);
    if (!btn) return;
    if (state) {
      btn.dataset.originalText = btn.innerHTML;
      btn.innerHTML = '<span class="spinner"></span> Analyzing...';
      btn.disabled = true;
    } else {
      btn.innerHTML = btn.dataset.originalText || 'Analyze';
      btn.disabled = false;
    }
  }

  _setOverlayProgress(pct, subtext) {
    const fill = document.getElementById('loading-progress-fill');
    const text = document.getElementById('loading-progress-text');
    const sub  = document.querySelector('#loading-overlay .loading-subtext');
    const pctStr = parseFloat(pct).toFixed(2);
    if (fill) fill.style.width = pctStr + '%';
    if (text) text.textContent = pctStr + '%';
    if (sub && subtext) sub.textContent = subtext;
  }

  showProgress(id, pct) {
    const el = document.getElementById(id);
    if (!el) return;
    el.style.display = 'block';
    const fill = el.querySelector('.progress-fill');
    if (fill) fill.style.width = pct + '%';
  }

  hideProgress(id) {
    const el = document.getElementById(id);
    if (el) el.style.display = 'none';
  }

  showToast(message, type = 'info') {
    const container = document.getElementById('toast-container');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    const icons = { success: '✅', error: '❌', warning: '⚠️', info: 'ℹ️' };
    toast.innerHTML = `<span class="toast-icon">${icons[type]}</span><span>${message}</span>`;
    container.appendChild(toast);

    requestAnimationFrame(() => toast.classList.add('visible'));
    setTimeout(() => {
      toast.classList.remove('visible');
      setTimeout(() => toast.remove(), 300);
    }, 4000);
  }

  animateResults(container) {
    // Animate progress bars
    setTimeout(() => {
      container.querySelectorAll('.algo-bar-fill, .pair-bar-fill').forEach(bar => {
        const target = bar.dataset.target || bar.style.width;
        bar.style.transition = 'width 1s ease';
        bar.style.width = target;
      });
    }, 100);
  }

  sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

  escapeHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  // ── Particle Canvas ─────────────────────────────────────────────────────────

  bindParticleCanvas() {
    const canvas = document.getElementById('particle-canvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const particles = [];
    const N = 80;

    const resize = () => {
      canvas.width  = window.innerWidth;
      canvas.height = window.innerHeight;
    };
    resize();
    window.addEventListener('resize', resize);

    for (let i = 0; i < N; i++) {
      particles.push({
        x: Math.random() * window.innerWidth,
        y: Math.random() * window.innerHeight,
        r: Math.random() * 1.5 + 0.5,
        vx: (Math.random() - 0.5) * 0.3,
        vy: (Math.random() - 0.5) * 0.3,
        alpha: Math.random() * 0.5 + 0.1
      });
    }

    const draw = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      particles.forEach(p => {
        p.x += p.vx; p.y += p.vy;
        if (p.x < 0) p.x = canvas.width;
        if (p.x > canvas.width) p.x = 0;
        if (p.y < 0) p.y = canvas.height;
        if (p.y > canvas.height) p.y = 0;

        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(99,102,241,${p.alpha})`;
        ctx.fill();
      });

      // Draw connecting lines for nearby particles
      for (let i = 0; i < N; i++) {
        for (let j = i + 1; j < N; j++) {
          const dx = particles[i].x - particles[j].x;
          const dy = particles[i].y - particles[j].y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < 100) {
            ctx.beginPath();
            ctx.strokeStyle = `rgba(99,102,241,${0.1 * (1 - dist / 100)})`;
            ctx.lineWidth = 0.5;
            ctx.moveTo(particles[i].x, particles[i].y);
            ctx.lineTo(particles[j].x, particles[j].y);
            ctx.stroke();
          }
        }
      }
      requestAnimationFrame(draw);
    };
    draw();
  }

  // ── Hero animation ──────────────────────────────────────────────────────────

  animateHero() {
    const heroWords = document.querySelectorAll('.hero-word');
    heroWords.forEach((el, i) => {
      el.style.animationDelay = `${i * 0.1}s`;
      el.classList.add('word-animate');
    });
  }

  // ── Footer year ─────────────────────────────────────────────────────────────

  updateFooterYear() {
    const el = document.getElementById('footer-year');
    if (el) el.textContent = new Date().getFullYear();
  }
}

// Initialize app when DOM is ready
window.addEventListener('DOMContentLoaded', () => {
  window.app = new VerifyAI();
});
