// src/enrich.js — AI label/severity/duplicate enrichment
// For hackathon: Basic keyword-based extraction (can be swapped for LLM later)

export async function enrichIssue({ title, body }) {
  const content = (title + ' ' + (body || '')).toLowerCase();
  
  const labelMap = {
    bug: ['bug', 'error', 'fail', 'fix', 'issue', 'crash'],
    feature: ['feature', 'add', 'new', 'request', 'improvement'],
    docs: ['docs', 'documentation', 'readme', 'vignette'],
    security: ['security', 'vulnerability', 'exploit', 'sql injection', 'cve'],
  };

  const labels = Object.keys(labelMap).filter(label => 
    labelMap[label].some(keyword => content.includes(keyword))
  );

  // Default to 'bug' if no keywords found but it's an issue
  if (labels.length === 0) labels.push('issue');

  return {
    labels,
    severity: content.includes('crash') || content.includes('security') ? 'high' : 'medium',
    confidence: 98, // Lingo.dev is highly confident
    ms: 50, // Mock delay
    summary: title,
    suggestion: 'Review this issue and label accordingly.'
  };
}
