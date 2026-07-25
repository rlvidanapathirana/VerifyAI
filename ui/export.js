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
        const sims = reportData.matrix[i].filter((_, j) => j !== i);
        const avg = sims.reduce((a, b) => a + b, 0) / (sims.length || 1);
        const max = Math.max(...sims);
        const maxIdx = reportData.matrix[i].indexOf(max);
        rows.push([
          doc.name,
          doc.stats?.wordCount || '-',
          `${Math.round(avg * 100)}%`,
          `${Math.round(max * 100)}%`,
          reportData.documents[maxIdx]?.name || '-'
        ]);
      });
    }

    const csvContent = rows.map(row =>
      row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(',')
    ).join('\r\n');

    this.downloadBlob(csvContent, `${filename}.csv`, 'text/csv;charset=utf-8;');
  }

  /* ─── PDF — Turnitin-Style White Report ────────────────────── */
  async exportPDF(reportData, filename = 'originality-report') {
    if (typeof html2pdf === 'undefined') {
      alert('html2pdf library not loaded. Please check your internet connection.');
      return;
    }

    // Try to find the Turnitin modal first (for single)
    let element = document.querySelector('.orig-report');
    
    // If modal is not open, we need to create a temporary container
    let tempContainer = null;
    if (!element) {
      if (window.app) {
        tempContainer = document.createElement('div');
        if (reportData.type === 'bulk' && window.app.renderBulkPDFTemplate) {
          tempContainer.innerHTML = window.app.renderBulkPDFTemplate(reportData);
        } else if (reportData.type === 'ai' && window.app.renderAIPDFTemplate) {
          tempContainer.innerHTML = window.app.renderAIPDFTemplate(reportData);
        } else if (window.app.renderTurnitinModal) {
          tempContainer.innerHTML = window.app.renderTurnitinModal(reportData);
        } else {
          alert("Cannot generate PDF: Report template not found.");
          return;
        }
        tempContainer.style.position = 'absolute';
        tempContainer.style.left = '-9999px';
        tempContainer.style.width = '800px'; // fixed width for PDF rendering
        tempContainer.style.background = '#fff';
        document.body.appendChild(tempContainer);
        element = tempContainer.firstElementChild;
      } else {
        alert("Cannot generate PDF: Report template not found.");
        return;
      }
    }

    // Ensure the element doesn't have overflow/height restrictions for PDF rendering
    const originalStyles = {
      maxHeight: element.style.maxHeight,
      overflow: element.style.overflow,
      height: element.style.height
    };
    element.style.maxHeight = 'none';
    element.style.overflow = 'visible';
    element.style.height = 'auto';

    // Configure html2pdf
    const opt = {
      margin:       [15, 10, 15, 10], // top, left, bottom, right
      filename:     `${filename}.pdf`,
      image:        { type: 'jpeg', quality: 0.98 },
      html2canvas:  { scale: 2, useCORS: true, logging: false, windowWidth: 800 },
      jsPDF:        { unit: 'mm', format: 'a4', orientation: 'portrait' },
      pagebreak:    { mode: ['css', 'legacy'] }
    };

    // Show loading overlay
    const overlay = document.getElementById('loading-overlay');
    if (overlay) {
      overlay.querySelector('.loading-text').textContent = "Generating PDF...";
      overlay.querySelector('.loading-subtext').textContent = "Rendering high-quality layout";
      overlay.classList.add('active');
    }

    try {
      await html2pdf().set(opt).from(element).save();
    } catch (e) {
      console.error("PDF generation failed", e);
      alert("Failed to generate PDF");
    } finally {
      if (tempContainer) {
        document.body.removeChild(tempContainer);
      } else {
        // Restore original styles if we used the active modal
        element.style.maxHeight = originalStyles.maxHeight;
        element.style.overflow = originalStyles.overflow;
        element.style.height = originalStyles.height;
      }
      if (overlay) {
        overlay.classList.remove('active');
      }
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
