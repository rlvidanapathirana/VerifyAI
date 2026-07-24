'use strict';
/**
 * VerifyAI File Parser
 * Handles: .txt, .pdf (PDF.js), .docx (Mammoth.js), .md
 * All parsing happens client-side in the browser
 */

class FileParser {
  /**
   * Parse any supported file and return plain text
   */
  async parse(file) {
    const ext = file.name.split('.').pop().toLowerCase();
    const name = file.name;
    const size = file.size;

    try {
      let text = '';
      switch (ext) {
        case 'txt':
        case 'md':
        case 'csv':
          text = await this.readAsText(file);
          break;
        case 'pdf':
          text = await this.parsePDF(file);
          break;
        case 'docx':
        case 'doc':
          text = await this.parseDOCX(file);
          break;
        default:
          throw new Error(`Unsupported file format: .${ext}`);
      }
      return { success: true, text: text.trim(), name, size, ext };
    } catch (err) {
      return { success: false, error: err.message, name, size, ext };
    }
  }

  /**
   * Read plain text file
   */
  readAsText(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = e => resolve(e.target.result);
      reader.onerror = () => reject(new Error('Failed to read file'));
      reader.readAsText(file, 'UTF-8');
    });
  }

  /**
   * Read file as ArrayBuffer
   */
  readAsArrayBuffer(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload  = e => resolve(e.target.result);
      reader.onerror = () => reject(new Error('Failed to read file as buffer'));
      reader.readAsArrayBuffer(file);
    });
  }

  /**
   * Parse PDF using PDF.js (loaded via CDN)
   */
  async parsePDF(file) {
    if (typeof pdfjsLib === 'undefined') {
      throw new Error('PDF.js not loaded. Please check your internet connection.');
    }

    const arrayBuffer = await this.readAsArrayBuffer(file);
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    const pages = [];

    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();
      const pageText = content.items.map(item => item.str).join(' ');
      pages.push(pageText);
    }

    return pages.join('\n\n');
  }

  /**
   * Parse DOCX using Mammoth.js (loaded via CDN)
   */
  async parseDOCX(file) {
    if (typeof mammoth === 'undefined') {
      throw new Error('Mammoth.js not loaded. Please check your internet connection.');
    }

    const arrayBuffer = await this.readAsArrayBuffer(file);
    const result = await mammoth.extractRawText({ arrayBuffer });
    if (result.messages && result.messages.length > 0) {
      console.warn('Mammoth warnings:', result.messages);
    }
    return result.value || '';
  }

  /**
   * Parse multiple files and return array of results
   */
  async parseMultiple(files) {
    const results = [];
    for (const file of files) {
      const result = await this.parse(file);
      results.push(result);
    }
    return results;
  }

  /**
   * Format file size for display
   */
  formatSize(bytes) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  /**
   * Validate file before parsing
   */
  validate(file) {
    const SUPPORTED_EXTS = ['txt', 'pdf', 'docx', 'doc', 'md', 'csv'];
    const ext = file.name.split('.').pop().toLowerCase();

    if (!SUPPORTED_EXTS.includes(ext)) {
      return { valid: false, error: `Unsupported format. Supported: ${SUPPORTED_EXTS.join(', ')}` };
    }
    if (file.size === 0) {
      return { valid: false, error: 'File is empty.' };
    }
    return { valid: true };
  }

  /**
   * Get file icon by extension
   */
  getFileIcon(ext) {
    const icons = {
      'pdf':  '📄',
      'docx': '📝',
      'doc':  '📝',
      'txt':  '📃',
      'md':   '📋',
      'csv':  '📊'
    };
    return icons[ext] || '📁';
  }
}

window.FileParser = FileParser;
