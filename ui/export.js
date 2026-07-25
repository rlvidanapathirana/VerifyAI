'use strict';
/**
 * VerifyAI Export Module — Turnitin-Style PDF Edition
 * Handles: PDF (Turnitin format), CSV, JSON exports
 */

class ExportManager {
  constructor() {}

  /* ─── JSON ─────────────────────────────────────────────────── */
  exportJSON(reportData, filename = 'verifyai-report') {
    const json = JSON.stringify(reportData, null, 2);
    this.downloadBlob(json, `${filename}.json`, 'application/json');
  }

  /* ─── CSV ──────────────────────────────────────────────────── */
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
      rows.push(['TF-IDF Cosine', r.similarity?.cosine || 0, `${Math.round((r.similarity?.cosine || 0) * 100)}%`]);
      rows.push(['Bigram Jaccard', r.similarity?.bigramJaccard || 0, `${Math.round((r.similarity?.bigramJaccard || 0) * 100)}%`]);
      rows.push(['Trigram Jaccard', r.similarity?.trigramJaccard || 0, `${Math.round((r.similarity?.trigramJaccard || 0) * 100)}%`]);
      rows.push(['Fingerprint (Winnowing)', r.fingerprint?.jaccard || 0, `${Math.round((r.fingerprint?.jaccard || 0) * 100)}%`]);
      rows.push(['LCS Similarity', r.lcs?.lcsSimilarity || 0, `${Math.round((r.lcs?.lcsSimilarity || 0) * 100)}%`]);
      rows.push(['COMBINED SCORE', r.similarity?.combined || 0, `${r.similarity?.plagiarismPercent || 0}%`]);
      rows.push([]);

      if (r.aiDetection) {
        rows.push(['AI DETECTION']);
        rows.push(['AI Score', r.aiDetection.aiPercent + '%']);
        rows.push(['Verdict', r.aiDetection.verdict]);
        rows.push(['Confidence', r.aiDetection.confidence]);
        rows.push(['Burstiness', r.aiDetection.signals?.burstiness || '-']);
        rows.push(['Lexical Diversity (TTR)', r.aiDetection.signals?.lexicalDiversity || '-']);
        rows.push(['Transition Word Density', r.aiDetection.signals?.transitionWordDensity || '-']);
        rows.push([]);
      }

      if (r.sentenceMatches?.length) {
        rows.push(['SENTENCE-LEVEL MATCHES']);
        rows.push(['Source Sentence', 'Reference Sentence', 'Similarity']);
        r.sentenceMatches.forEach(m => {
          rows.push([`"${m.sentenceA}"`, `"${m.sentenceB}"`, `${Math.round(m.similarity * 100)}%`]);
        });
      }
    } else if (reportData.type === 'bulk') {
      rows.push(['BULK ANALYSIS REPORT']);
      rows.push(['Document', 'Word Count', 'Avg Similarity with Others', 'Max Similarity', 'Most Similar To']);
      reportData.documents.forEach((doc, i) => {
        const sims = reportData.matrix ? reportData.matrix[i].filter((_, j) => j !== i) : [];
        const avg = sims.length ? sims.reduce((a, b) => a + b, 0) / sims.length : 0;
        const max = sims.length ? Math.max(...sims) : 0;
        const maxIdx = sims.length ? reportData.matrix[i].indexOf(max) : -1;
        rows.push([
          doc.name,
          doc.stats?.wordCount || '-',
          `${Math.round(avg * 100)}%`,
          `${Math.round(max * 100)}%`,
          maxIdx >= 0 ? reportData.documents[maxIdx]?.name || '-' : '-'
        ]);
      });
    }

    const csvContent = rows.map(row =>
      row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(',')
    ).join('\r\n');

    this.downloadBlob(csvContent, `${filename}.csv`, 'text/csv;charset=utf-8;');
  }

  /* ─── PDF — Clean A4 Report (no blank pages) ────────────────── */
  async exportPDF(reportData, filename = 'originality-report') {
    if (typeof html2pdf === 'undefined') {
      alert('html2pdf library not loaded. Please check your internet connection.');
      return;
    }

    // Show loading overlay
    const overlay = document.getElementById('loading-overlay');
    const overlayText = overlay?.querySelector('.loading-text');
    const overlaySub  = overlay?.querySelector('.loading-subtext');
    if (overlay) {
      if (overlayText) overlayText.textContent = 'Generating PDF...';
      if (overlaySub)  overlaySub.textContent  = 'Rendering high-quality report layout';
      overlay.classList.add('active');
    }

    if (!window.app) {
      alert('Cannot generate PDF: App not ready.');
      if (overlay) overlay.classList.remove('active');
      return;
    }

    // Build an off-screen container — always use template methods
    const container = document.createElement('div');
    container.style.cssText = 'position:absolute;left:-9999px;top:0;width:794px;background:#ffffff;';
    document.body.appendChild(container);

    try {
      let html = '';
      if (reportData.type === 'bulk') {
        html = window.app.renderBulkPDFTemplate(reportData);
      } else if (reportData.type === 'ai') {
        html = window.app.renderAIPDFTemplate(reportData);
      } else {
        html = window.app.renderTurnitinModal(reportData);
      }
      container.innerHTML = html;

      // Wait for layout reflow
      await new Promise(r => setTimeout(r, 400));

      const element = container.firstElementChild || container;
      element.style.maxHeight = 'none';
      element.style.overflow  = 'visible';
      element.style.height    = 'auto';

      const opt = {
        margin:      [12, 12, 12, 12],
        filename:    `${filename}.pdf`,
        image:       { type: 'jpeg', quality: 0.95 },
        html2canvas: {
          scale:       2,
          useCORS:     true,
          logging:     false,
          width:       794,
          windowWidth: 794,
          scrollX:     0,
          scrollY:     0
        },
        jsPDF:       { unit: 'mm', format: 'a4', orientation: 'portrait' },
        pagebreak:   { mode: 'css', before: '.pdf-page-break', avoid: '.no-break' }
      };

      await html2pdf().set(opt).from(element).save();
    } catch (e) {
      console.error('PDF generation failed', e);
      alert('Failed to generate PDF: ' + e.message);
    } finally {
      if (container.parentNode) document.body.removeChild(container);
      if (overlay) overlay.classList.remove('active');
    }
  }

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
