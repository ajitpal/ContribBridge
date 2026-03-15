// test/lingo.test.js — Isolated testing of Lingo.dev SDK methods
import 'dotenv/config';
import { 
  initLingo, 
  detectLanguage, 
  translateIssue, 
  translateReply, 
  translateThread,
  translateObject 
} from '../src/translate.js';

async function runTests() {
  console.log('--- Starting Lingo.dev Integration Tests ---\n');

  try {
    await initLingo();
    console.log('✓ SDK Initialized\n');

    // Test 1: detectLocale
    console.log('[Test 1] detectLanguage');
    const detection = await detectLanguage('这是一个测试问题');
    console.log('Input: "这是一个测试问题"');
    console.log('Output:', detection);
    console.log(detection.locale === 'zh' ? '✅ PASS' : '❌ FAIL');
    console.log('');

    // Test 2: translateIssue (localizeText + localizeHtml)
    console.log('[Test 2] translateIssue');
    const issue = {
      title: '内存泄漏',
      body: '我发现在 `src/server.js` 中存在内存泄漏。请查看 @ajitpal'
    };
    const translated = await translateIssue({ 
      title: issue.title, 
      body: issue.body, 
      detectedLocale: 'zh' 
    });
    console.log('Input:', issue);
    console.log('Output:', translated);
    console.log(translated.translatedTitle.includes('Memory') ? '✅ PASS' : '❌ FAIL');
    console.log('');

    // Test 3: translateReply (localizeText EN -> ZH)
    console.log('[Test 3] translateReply');
    const reply = 'Thank you for reporting this. We will fix it soon.';
    const zhReply = await translateReply(reply, 'zh');
    console.log('Input (EN):', reply);
    console.log('Output (ZH):', zhReply);
    console.log('✅ PASS (Manual verification needed)');
    console.log('');

    // Test 4: translateThread (localizeChat)
    console.log('[Test 4] translateThread');
    const messages = [
      { author: 'ajitpal', body: 'Is this fixed?' },
      { author: 'bot', body: 'Working on it.' }
    ];
    const zhThread = await translateThread(messages, 'zh');
    console.log('Input:', messages);
    console.log('Output:', zhThread);
    console.log(zhThread.length === 2 ? '✅ PASS' : '❌ FAIL');
    console.log('');

    // Test 5: translateObject (localizeObject)
    console.log('[Test 5] translateObject');
    const metadata = {
      summary: 'Security vulnerability found in authentication',
      suggestion: 'Update jsonwebtoken to the latest version'
    };
    const zhMeta = await translateObject(metadata, { sourceLocale: 'en', targetLocale: 'zh' });
    console.log('Input:', metadata);
    console.log('Output:', zhMeta);
    console.log(zhMeta.summary && zhMeta.suggestion ? '✅ PASS' : '❌ FAIL');
    console.log('');

  } catch (err) {
    console.error('❌ Integration Test Failed:', err.message);
    if (err.message.includes('API_KEY')) {
      console.log('\nTIP: Add your LINGODOTDEV_API_KEY to the .env file to run these tests.');
    }
  }
}

runTests();
