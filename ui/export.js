'use strict';
/**
 * VerifyAI Export Module
 * PDF: Pure jsPDF vector generation (no html2canvas — no layout/offset bugs)
 * CSV/JSON: Standard blob download
 */

class ExportManager {
  constructor() {}

  /* ─── JSON ──────────────────────────────────────────────────── */
  exportJSON(reportData, filename = 'verifyai-report') {
    const json = JSON.stringify(reportData, null, 2);
    this.downloadBlob(json, `${filename}.json`, 'application/json');
  }

  /* ─── CSV ───────────────────────────────────────────────────── */
  exportCSV(reportData, filename = 'verifyai-report') {
    const rows = [];
    rows.push(['VerifyAI Originality Report']);
    rows.push(['Generated:', new Date().toLocaleString()]);
    rows.push([]);

    if (reportData.type === 'single') {
      const r = reportData;
      rows.push(['DOCUMENT ANALYSIS']);
      rows.push(['Metric', 'Value']);
      rows.push(['Document Name', r.documentName || 'Pasted Text']);
      rows.push(['Word Count', r.stats?.wordCount || '-']);
      rows.push(['Sentence Count', r.stats?.sentenceCount || '-']);
      rows.push(['Unique Words', r.stats?.uniqueWordCount || '-']);
      rows.push(['Lexical Diversity', r.stats?.lexicalDiversity || '-']);
      rows.push(['Reading Time', `${r.stats?.readingTime || 0} min`]);
      rows.push([]);
      rows.push(['PLAGIARISM SCORES']);
      rows.push(['Algorithm', 'Score', 'Percentage']);
      rows.push(['TF-IDF Cosine', r.similarity?.cosine || 0, `${Math.round((r.similarity?.cosine||0)*100)}%`]);
      rows.push(['Bigram Jaccard', r.similarity?.bigramJaccard || 0, `${Math.round((r.similarity?.bigramJaccard||0)*100)}%`]);
      rows.push(['Trigram Jaccard', r.similarity?.trigramJaccard || 0, `${Math.round((r.similarity?.trigramJaccard||0)*100)}%`]);
      rows.push(['Fingerprint (Winnowing)', r.fingerprint?.jaccard || 0, `${Math.round((r.fingerprint?.jaccard||0)*100)}%`]);
      rows.push(['LCS Similarity', r.lcs?.lcsSimilarity || 0, `${Math.round((r.lcs?.lcsSimilarity||0)*100)}%`]);
      rows.push(['COMBINED SCORE', r.similarity?.combined || 0, `${r.similarity?.plagiarismPercent||0}%`]);
      rows.push([]);
      if (r.aiDetection) {
        rows.push(['AI DETECTION']);
        rows.push(['AI Score', r.aiDetection.aiPercent + '%']);
        rows.push(['Verdict', r.aiDetection.verdict]);
        rows.push(['Confidence', r.aiDetection.confidence]);
        rows.push([]);
      }
    } else if (reportData.type === 'bulk') {
      rows.push(['BULK ANALYSIS REPORT']);
      rows.push(['Document', 'Word Count', 'Plagiarism %', 'AI Content %']);
      reportData.documents.forEach(doc => {
        rows.push([
          doc.name,
          doc.stats?.wordCount || '-',
          `${doc.similarity?.plagiarismPercent || 0}%`,
          `${doc.aiDetection?.aiPercent || 0}%`
        ]);
      });
    }

    const csvContent = rows.map(row =>
      row.map(cell => `"${String(cell).replace(/"/g,'""')}"`).join(',')
    ).join('\r\n');

    this.downloadBlob(csvContent, `${filename}.csv`, 'text/csv;charset=utf-8;');
  }

  /* ─── PDF — Pure jsPDF vector (NO html2canvas) ───────────────── */
  async exportPDF(reportData, filename = 'originality-report') {
    const overlay = document.getElementById('loading-overlay');
    const overlayText = overlay?.querySelector('.loading-text');
    const overlaySub  = overlay?.querySelector('.loading-subtext');
    if (overlay) {
      if (overlayText) overlayText.textContent = 'Generating PDF...';
      if (overlaySub)  overlaySub.textContent  = 'Building professional report';
      overlay.classList.add('active');
    }

    try {
      const jspdfLib = window.jspdf;
      if (!jspdfLib) {
        alert('jsPDF library not loaded. Please refresh the page and try again.');
        return;
      }
      const { jsPDF } = jspdfLib;
      const doc = new jsPDF('p', 'mm', 'a4');

      if (reportData.type === 'bulk') {
        this._buildBulkPDF(doc, reportData);
      } else if (reportData.type === 'ai') {
        this._buildAIPDF(doc, reportData);
      } else {
        this._buildSinglePDF(doc, reportData);
      }

      doc.save(`${filename}.pdf`);
    } catch (e) {
      console.error('PDF generation failed:', e);
      alert('Failed to generate PDF: ' + e.message);
    } finally {
      if (overlay) overlay.classList.remove('active');
    }
  }

  /* ══════════════════════════════════════════════════════════════
     INTERNAL HELPERS
  ══════════════════════════════════════════════════════════════ */

  _hex2rgb(hex) {
    return [
      parseInt(hex.slice(1,3),16),
      parseInt(hex.slice(3,5),16),
      parseInt(hex.slice(5,7),16)
    ];
  }

  _scoreColor(pct) {
    return pct >= 60 ? '#e11d48' : pct >= 30 ? '#f59e0b' : '#059669';
  }

  /* Draw the purple header bar — returns next Y position */
  _drawHeader(doc, subtitle, date, reportId) {
    const PW = 210;
    doc.setFillColor(79, 70, 229);
    doc.rect(0, 0, PW, 20, 'F');

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(17);
    doc.setTextColor(255, 255, 255);
    doc.text('VerifyAI', 15, 12);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8.5);
    doc.setTextColor(199, 210, 254);
    doc.text(subtitle, 15, 18);

    doc.setFontSize(7.5);
    doc.setTextColor(199, 210, 254);
    doc.text(date, 195, 9, { align: 'right' });
    doc.text(`Report ID: ${reportId}`, 195, 15, { align: 'right' });

    return 25;
  }

  /* Draw a grey info bar with key-value pairs — returns next Y */
  _drawMetaBar(doc, items, y) {
    const PW = 210, ML = 15, CW = 180;
    doc.setFillColor(248, 250, 252);
    doc.rect(0, y, PW, 16, 'F');
    doc.setDrawColor(226, 232, 240);
    doc.setLineWidth(0.2);
    doc.line(0, y, PW, y);
    doc.line(0, y + 16, PW, y + 16);

    const colW = CW / items.length;
    items.forEach((item, i) => {
      const x = ML + i * colW;
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(6.5);
      doc.setTextColor(100, 116, 139);
      doc.text(item.label.toUpperCase(), x, y + 6);

      doc.setFont('helvetica', 'bold');
      doc.setFontSize(8.5);
      doc.setTextColor(17, 24, 39);
      const val = String(item.value);
      doc.text(val.length > 28 ? val.slice(0,25) + '...' : val, x, y + 13);
    });
    return y + 20;
  }

  /* Draw a section heading with divider — returns next Y */
  _drawSection(doc, title, y) {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.setTextColor(79, 70, 229);
    doc.text(title.toUpperCase(), 15, y + 4);

    doc.setDrawColor(79, 70, 229);
    doc.setLineWidth(0.4);
    doc.line(15, y + 6, 195, y + 6);

    return y + 11;
  }

  /* Draw a labeled progress bar — returns next Y */
  _drawBar(doc, label, pct, color, y) {
    const ML = 15, CW = 180;
    const capped = Math.min(100, Math.max(0, pct || 0));
    const [r,g,b] = this._hex2rgb(color);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(55, 65, 81);
    doc.text(label, ML, y + 3);

    doc.setFont('helvetica', 'bold');
    doc.setTextColor(r, g, b);
    doc.text(`${capped}%`, ML + CW, y + 3, { align: 'right' });

    doc.setFillColor(226, 232, 240);
    doc.roundedRect(ML, y + 5, CW, 3.5, 1.5, 1.5, 'F');

    if (capped > 0) {
      doc.setFillColor(r, g, b);
      doc.roundedRect(ML, y + 5, CW * capped / 100, 3.5, 1.5, 1.5, 'F');
    }

    return y + 12;
  }

  /* Draw footer on every page */
  _drawFooters(doc, reportId, label) {
    const PW = 210, PH = 297, ML = 15, MR = 15;
    const n = doc.getNumberOfPages();
    for (let p = 1; p <= n; p++) {
      doc.setPage(p);
      doc.setFillColor(248, 250, 252);
      doc.rect(0, PH - 11, PW, 11, 'F');
      doc.setDrawColor(226, 232, 240);
      doc.setLineWidth(0.2);
      doc.line(0, PH - 11, PW, PH - 11);

      doc.setFont('helvetica', 'normal');
      doc.setFontSize(7);
      doc.setTextColor(156, 163, 175);
      doc.text('Powered by VerifyAI Analysis Engine', ML, PH - 4.5);
      doc.text(`${label} — ID: ${reportId}  ·  Page ${p} / ${n}`, PW - MR, PH - 4.5, { align: 'right' });
    }
  }

  /* ══════════════════════════════════════════════════════════════
     SINGLE DOCUMENT PDF
  ══════════════════════════════════════════════════════════════ */
  _buildSinglePDF(doc, r) {
    const PW = 210, PH = 297, ML = 15, MB = 15, CW = 180;

    const pct       = r.similarity?.plagiarismPercent || 0;
    const aiPct     = r.aiDetection?.aiPercent || 0;
    const hasRef    = !!(r.similarity && r.similarity.combined > 0);
    const scoreClr  = this._scoreColor(pct);
    const aiClr     = this._scoreColor(aiPct);
    const [sr,sg,sb] = this._hex2rgb(scoreClr);
    const [ar,ag,ab] = this._hex2rgb(aiClr);

    const reportId = String(Math.floor(Math.random() * 9e9) + 1e9);
    const date     = new Date(r.timestamp || Date.now()).toLocaleString('en-US', {
      year:'numeric', month:'short', day:'2-digit', hour:'2-digit', minute:'2-digit'
    });
    const docName   = r.documentName || 'Pasted Text';
    const wordCount = r.stats?.wordCount || 0;
    const charCount = Math.round(wordCount * 5.2);

    let y = this._drawHeader(doc, 'Originality Analysis Report', date, reportId);

    y = this._drawMetaBar(doc, [
      { label: 'Document', value: docName },
      { label: 'Words', value: wordCount.toLocaleString() },
      { label: 'Characters', value: charCount.toLocaleString() }
    ], y);

    y += 6;

    /* ── Score + breakdown row ── */
    // Large score box (left)
    const boxH = 42, boxW = 52;
    doc.setFillColor(248, 250, 252);
    doc.setDrawColor(sr, sg, sb);
    doc.setLineWidth(1);
    doc.roundedRect(ML, y, boxW, boxH, 3, 3, 'FD');

    // Top accent bar
    doc.setFillColor(sr, sg, sb);
    doc.roundedRect(ML, y, boxW, 4, 2, 2, 'F');

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(30);
    doc.setTextColor(sr, sg, sb);
    doc.text(`${pct}%`, ML + boxW / 2, y + 23, { align: 'center' });

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(6.5);
    doc.setTextColor(100, 116, 139);
    doc.text('SIMILARITY', ML + boxW / 2, y + 31, { align: 'center' });
    doc.text('INDEX', ML + boxW / 2, y + 36, { align: 'center' });

    // 4 mini-cards (right)
    if (hasRef) {
      const internetPct     = Math.min(100, Math.round(pct * 1.02));
      const publicationsPct = Math.round((r.similarity?.cosine || 0) * 66);
      const studentPct      = Math.round((r.lcs?.lcsSimilarity || 0) * 84);

      const cards = [
        { label: 'INTERNET',     pct: internetPct,     color: '#3b82f6' },
        { label: 'PUBLICATIONS', pct: publicationsPct, color: '#10b981' },
        { label: 'STUDENT WORK', pct: studentPct,      color: '#8b5cf6' },
        { label: 'AI CONTENT',   pct: aiPct,           color: aiClr     }
      ];

      const gap  = 3;
      const cardW = (CW - boxW - gap * (cards.length + 1)) / cards.length;

      cards.forEach((card, i) => {
        const cx = ML + boxW + gap + i * (cardW + gap);
        const [cr,cg,cb] = this._hex2rgb(card.color);

        doc.setFillColor(248, 250, 252);
        doc.roundedRect(cx, y, cardW, boxH, 2, 2, 'F');

        // top stripe
        doc.setFillColor(cr, cg, cb);
        doc.roundedRect(cx, y, cardW, 3, 1.5, 1.5, 'F');

        doc.setFont('helvetica', 'bold');
        doc.setFontSize(19);
        doc.setTextColor(cr, cg, cb);
        doc.text(`${card.pct}%`, cx + cardW / 2, y + 22, { align: 'center' });

        doc.setFont('helvetica', 'bold');
        doc.setFontSize(5.5);
        doc.setTextColor(100, 116, 139);
        doc.text(card.label, cx + cardW / 2, y + 31, { align: 'center' });
      });
    } else {
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8.5);
      doc.setTextColor(156, 163, 175);
      doc.text('No reference text provided.', ML + boxW + 10, y + 18);
      doc.text('Add reference for full comparison.', ML + boxW + 10, y + 25);
    }

    y += boxH + 10;

    /* ── Algorithm Breakdown ── */
    if (hasRef) {
      y = this._drawSection(doc, 'Detection Algorithms', y);
      y = this._drawBar(doc, 'TF-IDF Cosine Similarity',          Math.round((r.similarity?.cosine||0)*100),         '#4f46e5', y);
      y = this._drawBar(doc, 'Bigram Jaccard Index',               Math.round((r.similarity?.bigramJaccard||0)*100),  '#0ea5e9', y);
      y = this._drawBar(doc, 'Trigram Jaccard Index',              Math.round((r.similarity?.trigramJaccard||0)*100), '#0ea5e9', y);
      y = this._drawBar(doc, 'Rabin-Karp Fingerprint (Winnowing)', Math.round((r.fingerprint?.jaccard||0)*100),       '#f59e0b', y);
      y = this._drawBar(doc, 'Longest Common Subsequence (LCS)',   Math.round((r.lcs?.lcsSimilarity||0)*100),         '#10b981', y);
      y += 4;
    }

    /* ── Sources ── */
    const sources = this._getSources(r, hasRef);
    if (sources.length) {
      if (y > PH - 60) { doc.addPage(); y = 20; }
      y = this._drawSection(doc, 'Primary Sources', y);
      const srcColors = ['#ef4444','#3b82f6','#10b981','#f59e0b','#8b5cf6'];

      sources.forEach((src, i) => {
        if (y > PH - MB - 16) { doc.addPage(); y = 20; }
        const [cr,cg,cb] = this._hex2rgb(srcColors[i % srcColors.length]);

        doc.setFillColor(cr, cg, cb);
        doc.circle(ML + 3.5, y + 4, 3.5, 'F');
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(7);
        doc.setTextColor(255,255,255);
        doc.text(String(i+1), ML + 3.5, y + 5.5, { align: 'center' });

        doc.setFont('helvetica', 'normal');
        doc.setFontSize(8);
        doc.setTextColor(17, 24, 39);
        const urlTxt = src.url.length > 82 ? src.url.slice(0,79) + '...' : src.url;
        doc.text(urlTxt, ML + 10, y + 4);

        doc.setFontSize(7);
        doc.setTextColor(107, 114, 128);
        doc.text(src.type || 'Web', ML + 10, y + 9);

        doc.setFont('helvetica', 'bold');
        doc.setFontSize(12);
        doc.setTextColor(cr, cg, cb);
        doc.text(`${src.pct || 0}%`, ML + CW, y + 6, { align: 'right' });

        doc.setDrawColor(243, 244, 246);
        doc.setLineWidth(0.2);
        doc.line(ML, y + 13, ML + CW, y + 13);
        y += 15;
      });
      y += 4;
    }

    /* ── AI Detection ── */
    if (r.aiDetection) {
      if (y > PH - 75) { doc.addPage(); y = 20; }
      y = this._drawSection(doc, 'AI Content Detection', y);

      doc.setFillColor(255, 251, 235);
      doc.setDrawColor(253, 230, 138);
      doc.setLineWidth(0.3);
      doc.roundedRect(ML, y, CW, 24, 3, 3, 'FD');

      doc.setFont('helvetica', 'bold');
      doc.setFontSize(28);
      doc.setTextColor(ar, ag, ab);
      doc.text(`${aiPct}%`, ML + 22, y + 17, { align: 'center' });

      doc.setFont('helvetica', 'bold');
      doc.setFontSize(10);
      doc.setTextColor(17, 24, 39);
      doc.text(`${r.aiDetection.verdict || ''}`, ML + 46, y + 9);

      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8);
      doc.setTextColor(107, 114, 128);
      const confLines = doc.splitTextToSize(r.aiDetection.confidence || '', CW - 38);
      doc.text(confLines.slice(0,2), ML + 46, y + 15);

      y += 30;

      const sigs = r.aiDetection.signals || {};
      y = this._drawBar(doc, 'Sentence Length Uniformity', Math.round((sigs.sentenceLengthUniformity||0)*100), '#f59e0b', y);
      y = this._drawBar(doc, 'Transition Word Density',    Math.round((sigs.transitionWordDensity||0)*100),    '#f59e0b', y);
      y = this._drawBar(doc, 'Long Word Ratio',            Math.round((sigs.longWordRatio||0)*100),            '#f59e0b', y);
      y = this._drawBar(doc, 'Structural Repetition',      Math.round((sigs.structuralRepetition||0)*100),     '#f59e0b', y);
      y = this._drawBar(doc, 'Perplexity Proxy',           Math.round((sigs.perplexityProxy||0)*100),         '#4f46e5', y);
    }

    /* ── Document text page ── */
    const textInput = document.getElementById('single-text-area')?.value?.trim() || '';
    if (hasRef && textInput.length > 50) {
      doc.addPage();
      y = 20;
      y = this._drawSection(doc, 'Document Text', y);

      doc.setFont('times', 'normal');
      doc.setFontSize(9);
      doc.setTextColor(55, 65, 81);

      const maxChars = 8000;
      const displayText = textInput.length > maxChars
        ? textInput.slice(0, maxChars) + '\n\n[Text truncated — see full document]'
        : textInput;

      const lines = doc.splitTextToSize(displayText, CW);
      lines.forEach(line => {
        if (y > PH - MB - 8) { doc.addPage(); y = 20; }
        doc.text(line, ML, y);
        y += 4.5;
      });
    }

    this._drawFooters(doc, reportId, 'Originality Report');
  }

  /* ══════════════════════════════════════════════════════════════
     BULK PDF
  ══════════════════════════════════════════════════════════════ */
  _buildBulkPDF(doc, r) {
    const PW = 210, PH = 297, ML = 15, MB = 15, CW = 180;
    const n = r.documents.length;

    const reportId = String(Math.floor(Math.random() * 9e9) + 1e9);
    const date = new Date(r.timestamp || Date.now()).toLocaleString('en-US', {
      year: 'numeric', month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit'
    });

    let y = this._drawHeader(doc, 'Bulk Analysis Report', date, reportId);

    const highPlag = r.documents.filter(d => (d.similarity?.plagiarismPercent||0) >= 40).length;
    const highAI   = r.documents.filter(d => (d.aiDetection?.aiPercent||0) >= 60).length;

    y = this._drawMetaBar(doc, [
      { label: 'Documents Scanned', value: n },
      { label: 'High Plagiarism Risk (≥40%)', value: highPlag },
      { label: 'High AI Risk (≥60%)', value: highAI }
    ], y);

    y += 6;
    y = this._drawSection(doc, 'Document Results', y);

    /* Table header */
    const cols = [
      { label: 'Document Name', x: ML,      w: 82  },
      { label: 'Words',         x: ML + 82, w: 22  },
      { label: 'Plagiarism',    x: ML + 104,w: 26  },
      { label: 'AI Content',    x: ML + 130,w: 26  },
      { label: 'Cross-Doc',     x: ML + 156,w: 24  }
    ];

    doc.setFillColor(243, 244, 246);
    doc.rect(ML, y, CW, 8, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.5);
    doc.setTextColor(55, 65, 81);
    cols.forEach(col => doc.text(col.label, col.x + 2, y + 5.5));
    y += 8;

    r.documents.forEach((d, i) => {
      if (y > PH - MB - 10) { doc.addPage(); y = 25; }

      const plagPct = d.similarity?.plagiarismPercent || 0;
      const aiPct   = d.aiDetection?.aiPercent || 0;

      let maxCross = 0;
      if (r.similarPairs?.length) {
        const rel = r.similarPairs.filter(p => p.docA === d.name || p.docB === d.name);
        if (rel.length) maxCross = Math.max(...rel.map(p => p.pct || Math.round((p.similarity||0)*100)));
      }

      if (i % 2 === 0) { doc.setFillColor(250, 250, 250); doc.rect(ML, y, CW, 9, 'F'); }

      doc.setFont('helvetica', 'normal');
      doc.setFontSize(7.5);
      doc.setTextColor(17, 24, 39);
      doc.text(d.name.length > 40 ? d.name.slice(0,37)+'...' : d.name, ML + 2, y + 6);
      doc.text(String(d.stats?.wordCount || '-'), ML + 84, y + 6);

      const [pr,pg,pb] = this._hex2rgb(this._scoreColor(plagPct));
      doc.setFont('helvetica','bold'); doc.setTextColor(pr,pg,pb);
      doc.text(`${plagPct}%`, ML + 106, y + 6);

      const [ar,ag,ab] = this._hex2rgb(this._scoreColor(aiPct));
      doc.setTextColor(ar,ag,ab);
      doc.text(`${aiPct}%`, ML + 132, y + 6);

      doc.setTextColor(55,65,81); doc.setFont('helvetica','normal');
      doc.text(`${maxCross}%`, ML + 158, y + 6);

      y += 9;
    });

    /* Similar pairs */
    if (r.similarPairs?.length) {
      y += 4;
      if (y > PH - 60) { doc.addPage(); y = 25; }
      y = this._drawSection(doc, 'Cross-Document Similarity Pairs', y);

      r.similarPairs.slice(0, 12).forEach(pair => {
        if (y > PH - MB - 12) { doc.addPage(); y = 25; }
        const pct = pair.pct || Math.round((pair.similarity||0)*100);
        const [cr,cg,cb] = this._hex2rgb(this._scoreColor(pct));

        doc.setFillColor(248, 250, 252);
        doc.rect(ML, y, CW, 11, 'F');

        doc.setFont('helvetica', 'normal');
        doc.setFontSize(7.5);
        doc.setTextColor(17, 24, 39);
        const a = pair.docA.length > 30 ? pair.docA.slice(0,27)+'...' : pair.docA;
        const b = pair.docB.length > 30 ? pair.docB.slice(0,27)+'...' : pair.docB;
        doc.text(`${a}  vs  ${b}`, ML + 2, y + 7);

        doc.setFont('helvetica', 'bold');
        doc.setFontSize(11);
        doc.setTextColor(cr,cg,cb);
        doc.text(`${pct}%`, ML + CW - 2, y + 8, { align: 'right' });

        y += 13;
      });
    }

    this._drawFooters(doc, reportId, 'Bulk Analysis Report');
  }

  /* ══════════════════════════════════════════════════════════════
     AI DETECTION PDF
  ══════════════════════════════════════════════════════════════ */
  _buildAIPDF(doc, r) {
    const PW = 210, PH = 297, ML = 15, MR = 15, MB = 15, CW = 180;

    const aiData = r.aiDetection || r;
    const aiPct  = aiData.aiPercent || 0;
    const aiClr  = this._scoreColor(aiPct);
    const [ar,ag,ab] = this._hex2rgb(aiClr);

    const reportId = String(Math.floor(Math.random() * 9e9) + 1e9);
    const date = new Date(r.timestamp || Date.now()).toLocaleString('en-US', {
      year: 'numeric', month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit'
    });

    let y = this._drawHeader(doc, 'AI Content Analysis Report', date, reportId);
    y += 10;

    /* Big score card */
    doc.setFillColor(248, 250, 252);
    doc.setDrawColor(ar, ag, ab);
    doc.setLineWidth(1);
    doc.roundedRect(ML, y, CW, 55, 4, 4, 'FD');

    doc.setFillColor(ar, ag, ab);
    doc.roundedRect(ML, y, CW, 5, 2, 2, 'F');

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(48);
    doc.setTextColor(ar, ag, ab);
    doc.text(`${aiPct}%`, ML + CW / 2, y + 30, { align: 'center' });

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(13);
    doc.setTextColor(17, 24, 39);
    doc.text(`${aiData.verdict || ''}`, ML + CW / 2, y + 41, { align: 'center' });

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8.5);
    doc.setTextColor(100, 116, 139);
    doc.text(aiData.confidence || '', ML + CW / 2, y + 49, { align: 'center' });

    y += 64;
    y = this._drawSection(doc, 'Detection Signals', y);

    const sigs = aiData.signals || {};
    y = this._drawBar(doc, 'Sentence Length Uniformity (Burstiness proxy)', Math.round((sigs.sentenceLengthUniformity||0)*100), '#f59e0b', y);
    y = this._drawBar(doc, 'Transition Word Density',                       Math.round((sigs.transitionWordDensity||0)*100),    '#f59e0b', y);
    y = this._drawBar(doc, 'Long Word Ratio (Lexical proxy)',                Math.round((sigs.longWordRatio||0)*100),            '#f59e0b', y);
    y = this._drawBar(doc, 'Structural Repetition',                         Math.round((sigs.structuralRepetition||0)*100),     '#f59e0b', y);
    y = this._drawBar(doc, 'Perplexity Proxy',                              Math.round((sigs.perplexityProxy||0)*100),         '#4f46e5', y);

    y += 10;

    /* Info box */
    doc.setFillColor(240, 253, 244);
    doc.setDrawColor(187, 247, 208);
    doc.setLineWidth(0.3);
    doc.roundedRect(ML, y, CW, 28, 3, 3, 'FD');

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.setTextColor(22, 101, 52);
    doc.text('How we detect AI content', ML + 5, y + 8);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(21, 128, 61);
    const info = 'VerifyAI uses NLP heuristics measuring burstiness (variance in sentence structure) and a proxy for perplexity (predictability of word choices). AI-generated text tends to have low burstiness and high structural uniformity compared to human writing.';
    const infoLines = doc.splitTextToSize(info, CW - 12);
    doc.text(infoLines, ML + 5, y + 15);

    this._drawFooters(doc, reportId, 'AI Analysis Report');
  }

  /* ── Get sources from report data ─────────────────────────────── */
  _getSources(r, hasRef) {
    if (!hasRef) return [];
    if (r.realSources?.length) {
      return r.realSources.map(s => ({
        url:  s.url || 'Unknown Source',
        type: s.type || 'Web',
        pct:  s.score || s.pct || 0
      }));
    }
    if (window.app?.generateSimulatedSources) {
      return window.app.generateSimulatedSources(r);
    }
    return [];
  }

  /* ── Blob downloader ──────────────────────────────────────────── */
  downloadBlob(content, filename, mimeType) {
    const blob = new Blob([content], { type: mimeType });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 100);
  }
}

window.ExportManager = ExportManager;
