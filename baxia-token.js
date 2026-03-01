/**
 * Qwen Chat API with Baxia Token Support
 * 使用 Puppeteer 模拟浏览器来绕过阿里云 Baxia 安全验证
 */

const puppeteer = require('puppeteer');
const { v4: uuidv4 } = require('uuid');

// 缓存
let browserInstance = null;
let pageInstance = null;

// Baxia Token 缓存
let baxiaTokenCache = {
  bxUa: null,
  bxUmidToken: null,
  bxV: '2.5.36',
  expiresAt: 0
};

/**
 * 获取 Baxia 安全 token (bx-ua, bx-umidtoken, bx-v)
 * 这些 token 用于阿里云安全验证
 * 
 * @param {Object} options - 选项
 * @param {boolean} options.skipCache - 是否跳过缓存，强制获取新 token
 * @param {boolean} options.freshContext - 是否使用新的浏览器上下文（让 bx-ua 变化）
 * @returns {Object} { bxUa, bxUmidToken, bxV }
 */
async function getBaxiaTokens(options = {}) {
  const { skipCache = false, freshContext = true } = options;
  const now = Date.now();
  
  // 缓存 5 分钟有效（除非跳过缓存）
  if (!skipCache && baxiaTokenCache.bxUa && baxiaTokenCache.expiresAt > now) {
    return {
      bxUa: baxiaTokenCache.bxUa,
      bxUmidToken: baxiaTokenCache.bxUmidToken,
      bxV: baxiaTokenCache.bxV
    };
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
  
  try {
    // 设置 User-Agent
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36');
    
    // 拦截请求，捕获 wu.json 的响应
    let umidToken = null;
    await page.setRequestInterception(true);
    
    page.on('response', async (response) => {
      if (response.url().includes('wu.json')) {
        const etag = response.headers()['etag'];
        if (etag) {
          umidToken = etag;
          console.log('[Baxia] Captured umidToken from ETag:', etag.substring(0, 20) + '...');
        }
      }
    });
    
    page.on('request', (request) => {
      request.continue();
    });
    
    // 访问 Qwen Chat 页面
    console.log('[Baxia] Navigating to chat.qwen.ai...');
    await page.goto('https://chat.qwen.ai', {
      waitUntil: 'networkidle2',
      timeout: 30000,
    });
    
    // 等待 Baxia SDK 加载完成
    await page.waitForFunction(() => {
      return window.baxiaCommon && typeof window.baxiaCommon.getUA === 'function';
    }, { timeout: 10000 });
    
    // 额外等待确保 umidToken 已获取
    await new Promise(resolve => setTimeout(resolve, 3000));
    
    // 在页面中获取 token
    const tokens = await page.evaluate(() => {
      const result = {
        bxUa: null,
        bxUmidToken: null,
        bxV: null,
        baxiaVersion: null,
        options: null
      };
      
      // 获取 bx-ua
      if (window.baxiaCommon && typeof window.baxiaCommon.getUA === 'function') {
        try {
          result.bxUa = window.baxiaCommon.getUA();
          result.bxV = window.baxiaCommon.version || '2.5.36';
        } catch (e) {
          console.error('Failed to get UA:', e);
        }
      }
      
      // 获取配置信息
      if (window.__baxia__ && window.__baxia__.options) {
        result.options = window.__baxia__.options;
      }
      
      return result;
    });
    
    // 使用拦截到的 umidToken 或尝试从页面获取
    tokens.bxUmidToken = umidToken;
    
    if (!tokens.bxUa) {
      throw new Error('Failed to get bx-ua token');
    }
    
    // 更新缓存
    baxiaTokenCache = {
      bxUa: tokens.bxUa,
      bxUmidToken: tokens.bxUmidToken,
      bxV: tokens.bxV || '2.5.36',
      expiresAt: now + 5 * 60 * 1000 // 5 分钟缓存
    };
    
    console.log('[Baxia] Tokens obtained successfully');
    console.log('[Baxia] bx-ua length:', tokens.bxUa.length);
    console.log('[Baxia] bx-umidtoken:', tokens.bxUmidToken ? tokens.bxUmidToken.substring(0, 20) + '...' : 'null');
    console.log('[Baxia] bx-v:', tokens.bxV);
    
    return {
      bxUa: tokens.bxUa,
      bxUmidToken: tokens.bxUmidToken,
      bxV: tokens.bxV || '2.5.36'
    };
    
  } catch (error) {
    console.error('[Baxia] Error fetching tokens:', error.message);
    throw error;
  } finally {
    await page.close();
    // 关闭 incognito context 以确保下次生成不同的指纹
    if (freshContext && context !== browser) {
      await context.close();
    }
  }
}
let currentChatId = null;  // 当前活跃的聊天会话 ID
let lastChatModel = null;  // 上一次使用的模型

/**
 * 获取或创建 browser 实例
 */
async function getBrowser() {
  if (!browserInstance || !browserInstance.isConnected()) {
    console.log('[Qwen] Launching browser...');
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
 * 获取或创建已认证的 page
 */
async function getAuthenticatedPage(authToken) {
  const browser = await getBrowser();
  
  if (!pageInstance || pageInstance.isClosed()) {
    console.log('[Qwen] Creating new page...');
    pageInstance = await browser.newPage();
    
    // 设置 User-Agent
    await pageInstance.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36');
    
    // 设置认证 token
    await pageInstance.evaluateOnNewDocument((token) => {
      localStorage.setItem('token', token);
    }, authToken);
    
    // 访问页面
    console.log('[Qwen] Navigating to chat.qwen.ai...');
    await pageInstance.goto('https://chat.qwen.ai', {
      waitUntil: 'networkidle2',
      timeout: 30000,
    });
    
    // 等待页面加载
    await new Promise(resolve => setTimeout(resolve, 3000));
  }
  
  return pageInstance;
}

/**
 * 关闭浏览器
 */
async function closeBrowser() {
  if (browserInstance) {
    await browserInstance.close();
    browserInstance = null;
    pageInstance = null;
  }
}

/**
 * 构建 Qwen 格式的消息
 */
function buildQwenMessage(content, role = 'user') {
  const fid = uuidv4();
  const responseId = uuidv4();
  
  return {
    fid,
    parentId: null,
    childrenIds: [responseId],
    role,
    content,
    user_action: 'chat',
    files: [],
    timestamp: Date.now(),
    models: ['qwen3.5-plus'],
    chat_type: 't2t',
    feature_config: {
      thinking_enabled: true,
      output_schema: 'phase',
      research_mode: 'normal',
      auto_thinking: true,
      thinking_format: 'summary',
      auto_search: true,
    },
    extra: {
      meta: {
        subChatType: 't2t',
      },
    },
    sub_chat_type: 't2t',
    parent_id: null,
  };
}

/**
 * 创建新的聊天会话
 */
async function createChat(authToken, model = 'qwen3.5-plus') {
  const page = await getAuthenticatedPage(authToken);
  
  const result = await page.evaluate(async ({ model }) => {
    const token = localStorage.getItem('token');
    if (!token) return { error: 'No token' };
    
    try {
      const response = await fetch('https://chat.qwen.ai/api/v2/chats/new', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        },
        body: JSON.stringify({ model }),
        credentials: 'include',
      });
      
      if (response.ok) {
        return { success: true, data: await response.json() };
      }
      return { error: `HTTP ${response.status}`, body: await response.text() };
    } catch (e) {
      return { error: e.message };
    }
  }, { model });
  
  return result;
}

/**
 * 在浏览器中发送聊天请求
 * @param {string} authToken - JWT token
 * @param {Array} messages - 消息数组
 * @param {string} model - 模型名称
 * @param {boolean} stream - 是否流式
 * @param {string} chatId - 可选的聊天会话 ID，用于连续对话
 */
async function sendChatRequest(authToken, messages, model = 'qwen3.5-plus', stream = true, chatId = null) {
  // 如果没有提供 chatId，决定是否复用现有会话
  const hasHistory = messages.length > 1;
  
  if (!chatId) {
    // 如果模型相同，复用会话（不管是否有历史对话）
    if (currentChatId && lastChatModel === model) {
      chatId = currentChatId;
      console.log(`[Qwen] Reusing chat session: ${chatId} (hasHistory: ${hasHistory})`);
    } else {
      // 创建新的聊天会话
      const chatCreateResult = await createChat(authToken, model);
      if (!chatCreateResult.success) {
        return { error: 'Failed to create chat', details: chatCreateResult };
      }
      
      chatId = chatCreateResult.data?.data?.id || uuidv4();
      currentChatId = chatId;
      lastChatModel = model;
      console.log(`[Qwen] Created new chat: ${chatId} (hasHistory: ${hasHistory})`);
    }
  }
  
  const page = await getAuthenticatedPage(authToken);
  const requestId = uuidv4();
  const timezone = new Date().toUTCString();
  
  console.log(`[Qwen] Sending chat request: model=${model}, stream=${stream}, chatId=${chatId}`);
  console.log(`[Qwen] Original messages count: ${messages.length}`);
  
  // Qwen API 不支持在 messages 中发送多条消息（包括历史对话）
  // 只发送最后一条用户消息
  const lastUserMessage = messages.filter(m => m.role === 'user').pop();
  const messagesToSend = lastUserMessage ? [lastUserMessage] : messages;
  
  console.log(`[Qwen] Messages to send: ${messagesToSend.length}`);
  
  // 将 OpenAI 格式的 messages 转换为 Qwen 格式
  const qwenMessages = messagesToSend.map(msg => {
    if (msg.role === 'user') {
      return buildQwenMessage(msg.content, 'user');
    } else if (msg.role === 'assistant') {
      return buildQwenMessage(msg.content, 'assistant');
    } else if (msg.role === 'system') {
      // 系统消息通常不需要特殊处理，可以忽略或转换
      return null;
    }
    return msg;
  }).filter(Boolean);
  
  // 构建请求体
  const requestBody = {
    stream,
    version: '2.1',
    incremental_output: true,
    chat_id: chatId,
    chat_mode: 'guest',
    model,
    parent_id: null,
    messages: qwenMessages,
    timestamp: Date.now(),
  };
  
  // 在页面上下文中执行 fetch 请求
  const result = await page.evaluate(async ({ chatId, requestId, timezone, model, requestBody, stream }) => {
    const token = localStorage.getItem('token');
    if (!token) {
      return { error: 'No auth token in localStorage' };
    }
    
    try {
      const response = await fetch(`https://chat.qwen.ai/api/v2/chat/completions?chat_id=${chatId}`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
          'Accept': 'application/json, text/event-stream',
          'x-request-id': requestId,
          'timezone': timezone,
          'source': 'web',
          'version': '0.2.9',
        },
        body: JSON.stringify(requestBody),
        credentials: 'include',
      });
      
      const contentType = response.headers.get('content-type') || '';
      
      if (!response.ok) {
        const text = await response.text();
        return { error: `HTTP ${response.status}`, body: text, status: response.status, contentType };
      }
      
      // 返回响应信息供调试
      const responseInfo = { status: response.status, contentType };
      
      if (stream && contentType.includes('text/event-stream')) {
        // 流式响应
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let chunks = [];
        
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          chunks.push(decoder.decode(value, { stream: true }));
        }
        
        const fullData = chunks.join('');
        return { stream: true, data: fullData, responseInfo };
      } else {
        // 非流式或非预期格式
        const text = await response.text();
        return { 
          success: false, 
          error: `Unexpected content-type: ${contentType}`, 
          data: text,
          responseInfo 
        };
      }
    } catch (e) {
      return { error: e.message };
    }
  }, { chatId, requestId, timezone, model, requestBody, stream });
  
  return result;
}

/**
 * 将 Qwen 响应转换为 OpenAI 格式
 */
function convertToOpenAIFormat(qwenResponse, model, stream = false) {
  const id = `chatcmpl-${uuidv4()}`;
  const created = Math.floor(Date.now() / 1000);
  
  if (stream) {
    // 解析 SSE 格式的流式响应
    const responseStr = typeof qwenResponse === 'string' ? qwenResponse : JSON.stringify(qwenResponse);
    const lines = responseStr.split('\n').filter(line => line.startsWith('data: '));
    const contentChunks = [];
    let finishReason = null;
    let usage = null;
    
    for (const line of lines) {
      const data = line.slice(6).trim();
      if (data === '[DONE]') continue;
      
      try {
        const parsed = JSON.parse(data);
        
        // 提取内容
        if (parsed.choices && parsed.choices[0]) {
          const choice = parsed.choices[0];
          if (choice.delta && choice.delta.content) {
            contentChunks.push(choice.delta.content);
          }
          if (choice.finish_reason) {
            finishReason = choice.finish_reason;
          }
        }
        
        // 提取 usage
        if (parsed.usage) {
          usage = parsed.usage;
        }
      } catch (e) {
        // 忽略解析错误
      }
    }
    
    return {
      id,
      object: 'chat.completion',
      created,
      model,
      choices: [{
        index: 0,
        message: {
          role: 'assistant',
          content: contentChunks.join(''),
        },
        finish_reason: finishReason || 'stop',
      }],
      usage: usage || { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
    };
  } else {
    // 非流式响应
    return {
      id,
      object: 'chat.completion',
      created,
      model,
      choices: [{
        index: 0,
        message: {
          role: 'assistant',
          content: qwenResponse.data?.choices?.[0]?.message?.content || '',
        },
        finish_reason: 'stop',
      }],
      usage: qwenResponse.data?.usage || { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
    };
  }
}

/**
 * 获取模型列表
 */
async function getModels(authToken) {
  const page = await getAuthenticatedPage(authToken);
  
  const result = await page.evaluate(async () => {
    const token = localStorage.getItem('token');
    if (!token) return { error: 'No token' };
    
    try {
      const response = await fetch('https://chat.qwen.ai/api/models', {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      });
      
      if (response.ok) {
        return { success: true, data: await response.json() };
      }
      return { error: `HTTP ${response.status}` };
    } catch (e) {
      return { error: e.message };
    }
  });
  
  return result;
}

module.exports = {
  sendChatRequest,
  getModels,
  closeBrowser,
  getBrowser,
  getAuthenticatedPage,
  convertToOpenAIFormat,
  buildQwenMessage,
  getBaxiaTokens,
};

// 直接运行时获取 tokens
if (require.main === module) {
  (async () => {
    try {
      console.log('Fetching Baxia tokens...\n');
      // skipCache: 跳过缓存
      // freshContext: 使用新的浏览器上下文，让 bx-ua 每次都不同
      const tokens = await getBaxiaTokens({ skipCache: true, freshContext: true });
      console.log('bx-ua:', tokens.bxUa.substring(0, 50) + '...');
      console.log('bx-umidtoken:', tokens.bxUmidToken);
      console.log('bx-v:', tokens.bxV);
      console.log('\nFull JSON:');
      console.log(JSON.stringify(tokens, null, 2));
    } catch (error) {
      console.error('Error:', error.message);
      process.exit(1);
    } finally {
      await closeBrowser();
    }
  })();
}