/**
 * test/ui_render.test.js
 * 
 * Mock data and basic verification logic for Dashboard UI components.
 * This script exports mock data that can be used to manually verify the UI
 * by injecting it into the dashboard page via the console.
 */

export const mockIssues = [
  {
    type: 'issue',
    repo: 'ajitpal/ContribBridge',
    number: 101,
    author: 'dmitry_fe',
    originalTitle: 'Границы ошибок не перехватывают асинхронные ошибки',
    originalBody: 'Ошибки в setTimeout или fetch не попадают в componentDidCatch.',
    translatedTitle: 'Error boundaries swallowing async errors in event handlers',
    translatedBody: 'Error boundaries do not catch asynchronous errors in event handlers. Errors in setTimeout or fetch calls do not reach componentDidCatch.',
    detectedLocale: 'ru',
    confidence: 93,
    labels: 'bug,error-boundary,async',
    timestamp: new Date().toISOString()
  },
  {
    type: 'issue',
    repo: 'ajitpal/markdown-converter-ui',
    number: 29,
    author: 'contributor',
    originalTitle: '¡Hola! El sistema no funciona',
    originalBody: 'He intentado registrarme pero el botón de envío no responde.',
    translatedTitle: 'Hello! The system does not work',
    translatedBody: 'I have tried to register but the submit button does not respond.',
    detectedLocale: 'es',
    confidence: 98,
    labels: 'bug',
    timestamp: new Date().toISOString()
  }
];

export const mockComments = [
  {
    type: 'comment',
    id: 12345,
    issueNumber: 101,
    repo: 'ajitpal/ContribBridge',
    author: 'ajitpal',
    originalBody: 'I will look into it',
    translatedBody: 'Lo investigaré',
    direction: 'en → es',
    timestamp: new Date().toISOString()
  }
];

console.log('Mock UI data generated for testing.');
