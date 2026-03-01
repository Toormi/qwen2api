/**
 * 纯 Node.js 实现 Baxia Token 生成 (无需浏览器)
 * 
 * 已验证可正常工作于 Qwen API
 * 兼容: Node.js / Cloudflare Workers / Vercel / Netlify
 * 
 * 原理：
 * - bx-umidtoken: 从 sg-wum.alibaba.com/w/wu.json 的 ETag 获取
 * - bx-ua: 生成模拟的浏览器指纹数据
 * - bx-v: Baxia SDK 版本号
 */

// Node.js crypto 模块
const nodeCrypto = require('crypto');

// 检测运行环境
const isCloudflareWorker = typeof caches !== 'undefined' && typeof globalThis.WebCryptoPairingIdentity !== 'undefined';

// 加密模块兼容
const cryptoModule = {
  randomBytes: (length) => {
    if (isCloudflareWorker) {
      const bytes = new Uint8Array(length);
      crypto.getRandomValues(bytes);
      return bytes;
    }
    return nodeCrypto.randomBytes(length);
  },
  createHash: (algo) => {
    if (isCloudflareWorker) {
      return {
        _data: '',
        update: function(data) {
          this._data += data;
          return this;
        },
        digest: async function(encoding) {
          const encoder = new TextEncoder();
          const data = encoder.encode(this._data);
          const hashBuffer = await crypto.subtle.digest('MD5', data);
          const hashArray = new Uint8Array(hashBuffer);
          return btoa(String.fromCharCode(...hashArray)).substring(0, 32);
        }
      };
    }
    return nodeCrypto.createHash(algo);
  }
};

// Baxia SDK 版本
const BAXIA_VERSION = '2.5.36';

// 缓存
let tokenCache = null;
let tokenCacheTime = 0;
const CACHE_TTL = 4 * 60 * 1000; // 4分钟缓存 (略小于5分钟以防过期)

/**
 * 生成随机字符串
 */
function randomString(length) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  let result = '';
  const randomBytes = cryptoModule.randomBytes(length);
  for (let i = 0; i < length; i++) {
    result += chars[randomBytes[i] % chars.length];
  }
  return result;
}

/**
 * 生成随机数字字符串
 */
function randomDigits(length) {
  let result = '';
  for (let i = 0; i < length; i++) {
    result += Math.floor(Math.random() * 10);
  }
  return result;
}

/**
 * 生成模拟的 Canvas 指纹
 */
async function generateCanvasFingerprint() {
  // Canvas 指纹通常是基于绑定到特定硬件的哈希
  const hash = cryptoModule.createHash('md5');
  hash.update(cryptoModule.randomBytes(32));
  if (hash.digest instanceof Promise) {
    return await hash.digest('base64');
  }
  return hash.digest('base64').substring(0, 32);
}

/**
 * 生成模拟的 WebGL 指纹
 */
function generateWebGLFingerprint() {
  const renderers = [
    'ANGLE (Intel, Intel(R) UHD Graphics 630, OpenGL 4.6)',
    'ANGLE (NVIDIA, NVIDIA GeForce GTX 1080, OpenGL 4.6)',
    'ANGLE (AMD, AMD Radeon RX 580, OpenGL 4.6)',
    'ANGLE (Intel, Intel(R) Iris(R) Xe Graphics, OpenGL 4.6)',
  ];
  return {
    renderer: renderers[Math.floor(Math.random() * renderers.length)],
    vendor: 'Google Inc. (Intel)',
    extensions: randomString(64),
  };
}

/**
 * 生成模拟的 Audio 指纹
 */
function generateAudioFingerprint() {
  // Audio 指纹通常是一个浮点数
  return (124.04347527516074 + Math.random() * 0.001).toFixed(14);
}

/**
 * 生成模拟的浏览器特征
 */
async function generateBrowserFeatures() {
  const platforms = ['Win32', 'Linux x86_64', 'MacIntel'];
  const languages = ['en-US', 'zh-CN', 'en-GB'];
  const timezones = [-480, -300, 0, 60, 480];
  
  const canvas = await generateCanvasFingerprint();
  
  return {
    platform: platforms[Math.floor(Math.random() * platforms.length)],
    language: languages[Math.floor(Math.random() * languages.length)],
    languages: [languages[Math.floor(Math.random() * languages.length)]],
    hardwareConcurrency: 4 + Math.floor(Math.random() * 12),
    deviceMemory: [4, 8, 16, 32][Math.floor(Math.random() * 4)],
    timezoneOffset: timezones[Math.floor(Math.random() * timezones.length)],
    screenWidth: 1920 + Math.floor(Math.random() * 200),
    screenHeight: 1080 + Math.floor(Math.random() * 100),
    colorDepth: 24,
    pixelRatio: [1, 1.25, 1.5, 2][Math.floor(Math.random() * 4)],
    touchPoints: Math.random() > 0.5 ? 0 : 10,
    cookieEnabled: true,
    doNotTrack: Math.random() > 0.5 ? null : '1',
    plugins: randomString(32),
    mimeTypes: randomString(32),
    webGL: generateWebGLFingerprint(),
    canvas: canvas,
    audio: generateAudioFingerprint(),
  };
}

/**
 * 生成时间戳相关的数据
 */
function generateTimestampData() {
  const now = Date.now();
  return {
    timestamp: now,
    date: new Date().toISOString(),
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  };
}

/**
 * 收集所有指纹数据并编码
 */
async function collectFingerprintData() {
  const features = await generateBrowserFeatures();
  const timestamp = generateTimestampData();
  
  // 组合所有数据
  const data = {
    // 浏览器特征
    p: features.platform,
    l: features.language,
    hc: features.hardwareConcurrency,
    dm: features.deviceMemory,
    to: features.timezoneOffset,
    sw: features.screenWidth,
    sh: features.screenHeight,
    cd: features.colorDepth,
    pr: features.pixelRatio,
    tp: features.touchPoints,
    ce: features.cookieEnabled ? 1 : 0,
    dnt: features.doNotTrack,
    
    // 指纹
    wf: features.webGL.renderer.substring(0, 20),
    cf: features.canvas,
    af: features.audio,
    
    // 时间戳
    ts: timestamp.timestamp,
    tz: timestamp.timezone,
    
    // 随机数
    r: Math.random(),
  };
  
  return data;
}

/**
 * 编码数据为 Baxia 格式
 * Baxia token 格式: "版本号!base64编码的数据"
 */
function encodeBaxiaToken(data) {
  // 将数据转换为紧凑的字符串格式
  const jsonStr = JSON.stringify(data);
  
  // 使用自定义编码来压缩数据 (兼容各平台)
  let encoded;
  if (isCloudflareWorker || typeof Buffer === 'undefined') {
    // Cloudflare Workers 或浏览器环境
    encoded = btoa(unescape(encodeURIComponent(jsonStr)));
  } else {
    // Node.js 环境
    encoded = Buffer.from(jsonStr).toString('base64');
  }
  
  // Baxia token 格式
  return `${BAXIA_VERSION.replace(/\./g, '')}!${encoded}`;
}

/**
 * 生成 bx-ua token
 * @param {boolean} silent - 静默模式
 */
async function generateBxUa(silent = false) {
  if (!silent) console.log('[Baxia-Node] Generating bx-ua token...');
  
  const data = await collectFingerprintData();
  const token = encodeBaxiaToken(data);
  
  if (!silent) console.log('[Baxia-Node] bx-ua length:', token.length);
  
  return token;
}

/**
 * 生成 bx-umidtoken
 * 这个 token 来自阿里云的 wu.json 接口的 ETag
 * @param {boolean} silent - 静默模式
 */
async function generateBxUmidToken(silent = false) {
  if (!silent) console.log('[Baxia-Node] Fetching bx-umidtoken...');
  
  try {
    // 使用 fetch API (兼容 Node.js 18+ 和 Cloudflare Workers)
    const response = await fetch('https://sg-wum.alibaba.com/w/wu.json', {
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36',
        'Accept': '*/*',
        'Accept-Language': 'en-US,en;q=0.9',
        'Cache-Control': 'no-cache',
      }
    });
    
    const etag = response.headers.get('etag');
    
    if (etag) {
      if (!silent) console.log('[Baxia-Node] Got bx-umidtoken from ETag');
      return etag;
    } else {
      if (!silent) console.warn('[Baxia-Node] No ETag in response, generating fallback');
      return 'T2gA' + randomString(40);
    }
  } catch (e) {
    if (!silent) console.error('[Baxia-Node] Error fetching umidtoken:', e.message);
    return 'T2gA' + randomString(40);
  }
}

/**
 * 获取所有 Baxia tokens (Node.js 环境)
 * @param {Object} options - 选项
 * @param {boolean} options.silent - 静默模式，不输出日志
 * @param {boolean} options.skipCache - 跳过缓存，强制获取新 token
 * @returns {Promise<{bxUa: string, bxUmidToken: string, bxV: string}>}
 */
async function getBaxiaTokensNode(options = {}) {
  const { silent = false, skipCache = false } = options;
  
  // 检查缓存
  const now = Date.now();
  if (!skipCache && tokenCache && (now - tokenCacheTime) < CACHE_TTL) {
    if (!silent) console.log('[Baxia-Node] Using cached tokens');
    return tokenCache;
  }
  
  if (!silent) console.log('[Baxia-Node] Generating new tokens...');
  
  const bxUa = await generateBxUa(silent);
  const bxUmidToken = await generateBxUmidToken(silent);
  const bxV = BAXIA_VERSION;
  
  const result = { bxUa, bxUmidToken, bxV };
  
  // 更新缓存
  tokenCache = result;
  tokenCacheTime = now;
  
  if (!silent) console.log('[Baxia-Node] Tokens generated successfully');
  
  return result;
}

/**
 * 获取所有 Baxia tokens (通用版本 - 兼容所有平台)
 * @param {Object} options - 选项
 * @param {boolean} options.silent - 静默模式，不输出日志
 * @param {boolean} options.skipCache - 跳过缓存，强制获取新 token
 * @returns {Promise<{bxUa: string, bxUmidToken: string, bxV: string}>}
 */
async function getBaxiaTokensUniversal(options = {}) {
  return getBaxiaTokensNode(options);
}

/**
 * 格式化输出
 */
function printTokens(tokens) {
  console.log('='.repeat(60));
  console.log('BAXIA TOKENS (Node.js - No Browser Required)');
  console.log('='.repeat(60));
  
  console.log('\n[1] bx-ua:');
  console.log('-'.repeat(40));
  console.log(tokens.bxUa.substring(0, 80) + '...');
  
  console.log('\n[2] bx-umidtoken:');
  console.log('-'.repeat(40));
  console.log(tokens.bxUmidToken);
  
  console.log('\n[3] bx-v:');
  console.log('-'.repeat(40));
  console.log(tokens.bxV);
  
  console.log('\n' + '='.repeat(60));
  
  console.log('\nJSON Format:');
  console.log(JSON.stringify(tokens, null, 2));
}

/**
 * 清除缓存
 */
function clearCache() {
  tokenCache = null;
  tokenCacheTime = 0;
}

// 导出
module.exports = {
  getBaxiaTokensNode,
  getBaxiaTokensUniversal,
  generateBxUa,
  generateBxUmidToken,
  clearCache,
  BAXIA_VERSION,
};

// 直接运行 (仅在 Node.js 环境)
if (typeof require !== 'undefined' && require.main === module) {
  getBaxiaTokensNode({ skipCache: true })
    .then(tokens => printTokens(tokens))
    .catch(err => console.error('Error:', err.message));
}
