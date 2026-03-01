/**
 * 独立获取 Baxia Token
 * 可单独运行: node fetch-baxia.js
 * 
 * 输出三个 token:
 * - bx-ua: 用户行为指纹 token
 * - bx-umidtoken: UMID 设备标识 token  
 * - bx-v: Baxia SDK 版本号
 */

const puppeteer = require('puppeteer');

// 缓存
let browserInstance = null;
let tokenCache = null;
let tokenCacheTime = 0;
const CACHE_TTL = 5 * 60 * 1000; // 5分钟缓存

/**
 * 获取或创建 browser 实例
 */
async function getBrowser() {
  if (!browserInstance || !browserInstance.isConnected()) {
    console.log('[Baxia] Launching browser...');
    browserInstance = await puppeteer.launch({
      headless: 'new',
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--disable-blink-features=AutomationControlled',
      ],
      ignoreDefaultArgs: ['--enable-automation'],
    });
  }
  return browserInstance;
}

/**
 * 生成随机浏览器特征
 */
function randomizeFeatures() {
  const platforms = ['Win32', 'Linux x86_64', 'MacIntel'];
  const languages = ['en-US,en', 'zh-CN,zh', 'en-GB,en'];
  const timezones = [-8, -5, 0, 1, 8];
  
  return {
    platform: platforms[Math.floor(Math.random() * platforms.length)],
    language: languages[Math.floor(Math.random() * languages.length)],
    timezoneOffset: timezones[Math.floor(Math.random() * timezones.length)] * 60,
    screenWidth: 1920 + Math.floor(Math.random() * 200),
    screenHeight: 1080 + Math.floor(Math.random() * 100),
  };
}

/**
 * 关闭浏览器
 */
async function closeBrowser() {
  if (browserInstance) {
    await browserInstance.close();
    browserInstance = null;
  }
}

/**
 * 获取 Baxia Tokens
 * @param {Object} options - 选项
 * @param {boolean} options.skipCache - 是否跳过缓存，强制获取新 token
 * @param {boolean} options.freshContext - 是否使用新的浏览器上下文（让 bx-ua 变化）
 * @returns {Promise<{bxUa: string, bxUmidToken: string, bxV: string}>}
 */
async function getBaxiaTokens(options = {}) {
  const { skipCache = false, freshContext = true } = options;
  
  // 检查缓存
  const now = Date.now();
  if (!skipCache && tokenCache && (now - tokenCacheTime) < CACHE_TTL) {
    console.log('[Baxia] Returning cached tokens');
    return tokenCache;
  }

  console.log('[Baxia] Fetching new tokens...');
  
  const browser = await getBrowser();
  
  // 使用新的浏览器上下文（incognito）来生成不同的指纹
  let context;
  if (freshContext) {
    // Puppeteer 新版本使用 createBrowserContext
    context = typeof browser.createBrowserContext === 'function' 
      ? await browser.createBrowserContext()
      : browser;
  } else {
    context = browser;
  }
  const page = await context.newPage();
  
  // 存储捕获的 umidToken
  let capturedUmidToken = null;
  
  // 拦截网络请求获取 umidToken
  await page.setRequestInterception(true);
  page.on('response', async (response) => {
    if (response.url().includes('sg-wum.alibaba.com/w/wu.json')) {
      const etag = response.headers()['etag'];
      if (etag) {
        capturedUmidToken = etag;
        console.log('[Baxia] Captured umidToken from ETag:', etag.substring(0, 20) + '...');
      }
    }
  });
  
  page.on('request', (request) => {
    request.continue();
  });
  
  try {
    // 随机化浏览器特征
    const features = randomizeFeatures();
    
    // 设置 User-Agent
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36');
    
    // 注入随机特征
    await page.evaluateOnNewDocument((feat) => {
      Object.defineProperty(navigator, 'platform', { get: () => feat.platform });
      Object.defineProperty(navigator, 'language', { get: () => feat.language });
      Object.defineProperty(navigator, 'languages', { get: () => [feat.language] });
      Object.defineProperty(screen, 'width', { get: () => feat.screenWidth });
      Object.defineProperty(screen, 'height', { get: () => feat.screenHeight });
      // 随机 canvas 指纹噪声
      const originalGetContext = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function(type, attributes) {
        const ctx = originalGetContext.call(this, type, attributes);
        if (type === '2d') {
          const originalGetImageData = ctx.getImageData;
          ctx.getImageData = function(x, y, w, h) {
            const data = originalGetImageData.call(this, x, y, w, h);
            for (let i = 0; i < data.data.length; i += 4) {
              data.data[i] ^= (Math.random() * 2) | 0;
            }
            return data;
          };
        }
        return ctx;
      };
    }, features);
    
    // 访问页面
    console.log('[Baxia] Navigating to chat.qwen.ai...');
    await page.goto('https://chat.qwen.ai', {
      waitUntil: 'networkidle2',
      timeout: 30000,
    });
    
    // 等待 baxiaCommon 加载
    await page.waitForFunction(() => {
      return window.baxiaCommon && typeof window.baxiaCommon.getUA === 'function';
    }, { timeout: 10000 });
    
    // 等待 umidToken 请求完成
    await new Promise(resolve => setTimeout(resolve, 3000));
    
    // 获取 tokens
    const tokens = await page.evaluate(() => {
      const bxUa = window.baxiaCommon.getUA();
      const bxV = window.baxiaCommon.version;
      return { bxUa, bxV };
    });
    
    // 等待 umidToken
    let retries = 0;
    while (!capturedUmidToken && retries < 10) {
      await new Promise(resolve => setTimeout(resolve, 1000));
      retries++;
    }
    
    if (!capturedUmidToken) {
      console.warn('[Baxia] Warning: umidToken not captured, using empty string');
      capturedUmidToken = '';
    }
    
    const result = {
      bxUa: tokens.bxUa,
      bxUmidToken: capturedUmidToken,
      bxV: tokens.bxV,
    };
    
    // 更新缓存
    tokenCache = result;
    tokenCacheTime = now;
    
    console.log('[Baxia] Tokens obtained successfully');
    console.log('[Baxia] bx-ua length:', result.bxUa.length);
    console.log('[Baxia] bx-umidtoken:', result.bxUmidToken.substring(0, 30) + '...');
    console.log('[Baxia] bx-v:', result.bxV);
    
    return result;
    
  } finally {
    await page.close();
    // 关闭 incognito context 以确保下次生成不同的指纹
    if (freshContext && context !== browser) {
      await context.close();
    }
  }
}

/**
 * 格式化输出
 */
function printTokens(tokens) {
  console.log('\n' + '='.repeat(60));
  console.log('BAXIA TOKENS');
  console.log('='.repeat(60));
  
  console.log('\n[1] bx-ua (User Agent Behavior Token):');
  console.log('-'.repeat(40));
  console.log(tokens.bxUa);
  
  console.log('\n[2] bx-umidtoken (UMID Device Token):');
  console.log('-'.repeat(40));
  console.log(tokens.bxUmidToken);
  
  console.log('\n[3] bx-v (Baxia Version):');
  console.log('-'.repeat(40));
  console.log(tokens.bxV);
  
  console.log('\n' + '='.repeat(60));
  
  // JSON 格式输出
  console.log('\nJSON Format:');
  console.log(JSON.stringify(tokens, null, 2));
}

// 主函数 - 直接运行时执行
async function main() {
  try {
    const tokens = await getBaxiaTokens();
    printTokens(tokens);
  } catch (error) {
    console.error('[Baxia] Error:', error.message);
    process.exit(1);
  } finally {
    await closeBrowser();
  }
}

// 导出模块
module.exports = {
  getBaxiaTokens,
  closeBrowser,
};

// 如果直接运行此文件
if (require.main === module) {
  main();
}
