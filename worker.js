/**
 * Cloudflare Workers 入口
 * 
 * 使用方法:
 * 1. 安装 wrangler: npm install -g wrangler
 * 2. 登录: wrangler login
 * 3. 部署: wrangler deploy
 */

import { v4 as uuidv4 } from 'uuid';

// ============================================
// Baxia Token 生成 (Cloudflare Workers 版本)
// ============================================

const BAXIA_VERSION = '2.5.36';

function randomString(length) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  let result = '';
  const randomBytes = new Uint8Array(length);
  crypto.getRandomValues(randomBytes);
  for (let i = 0; i < length; i++) {
    result += chars[randomBytes[i] % chars.length];
  }
  return result;
}

function generateWebGLFingerprint() {
  const renderers = [
    'ANGLE (Intel, Intel(R) UHD Graphics 630, OpenGL 4.6)',
    'ANGLE (NVIDIA, NVIDIA GeForce GTX 1080, OpenGL 4.6)',
    'ANGLE (AMD, AMD Radeon RX 580, OpenGL 4.6)',
  ];
  return {
    renderer: renderers[Math.floor(Math.random() * renderers.length)],
    vendor: 'Google Inc. (Intel)',
  };
}

async function generateCanvasFingerprint() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  const hashBuffer = await crypto.subtle.digest('MD5', bytes);
  const hashArray = new Uint8Array(hashBuffer);
  return btoa(String.fromCharCode(...hashArray)).substring(0, 32);
}

async function generateBrowserFeatures() {
  const platforms = ['Win32', 'Linux x86_64', 'MacIntel'];
  const languages = ['en-US', 'zh-CN', 'en-GB'];
  const timezones = [-480, -300, 0, 60, 480];
  
  const canvas = await generateCanvasFingerprint();
  
  return {
    platform: platforms[Math.floor(Math.random() * platforms.length)],
    language: languages[Math.floor(Math.random() * languages.length)],
    hardwareConcurrency: 4 + Math.floor(Math.random() * 12),
    deviceMemory: [4, 8, 16, 32][Math.floor(Math.random() * 4)],
    timezoneOffset: timezones[Math.floor(Math.random() * timezones.length)],
    screenWidth: 1920 + Math.floor(Math.random() * 200),
    screenHeight: 1080 + Math.floor(Math.random() * 100),
    colorDepth: 24,
    pixelRatio: [1, 1.25, 1.5, 2][Math.floor(Math.random() * 4)],
    webGL: generateWebGLFingerprint(),
    canvas: canvas,
    audio: (124.04347527516074 + Math.random() * 0.001).toFixed(14),
  };
}

async function collectFingerprintData() {
  const features = await generateBrowserFeatures();
  return {
    p: features.platform,
    l: features.language,
    hc: features.hardwareConcurrency,
    dm: features.deviceMemory,
    to: features.timezoneOffset,
    sw: features.screenWidth,
    sh: features.screenHeight,
    cd: features.colorDepth,
    pr: features.pixelRatio,
    wf: features.webGL.renderer.substring(0, 20),
    cf: features.canvas,
    af: features.audio,
    ts: Date.now(),
    r: Math.random(),
  };
}

function encodeBaxiaToken(data) {
  const jsonStr = JSON.stringify(data);
  const encoded = btoa(unescape(encodeURIComponent(jsonStr)));
  return `${BAXIA_VERSION.replace(/\./g, '')}!${encoded}`;
}

async function generateBxUa() {
  const data = await collectFingerprintData();
  return encodeBaxiaToken(data);
}

async function generateBxUmidToken() {
  try {
    const response = await fetch('https://sg-wum.alibaba.com/w/wu.json', {
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': '*/*',
      }
    });
    const etag = response.headers.get('etag');
    return etag || 'T2gA' + randomString(40);
  } catch (e) {
    return 'T2gA' + randomString(40);
  }
}

async function getBaxiaTokens() {
  const bxUa = await generateBxUa();
  const bxUmidToken = await generateBxUmidToken();
  return { bxUa, bxUmidToken, bxV: BAXIA_VERSION };
}

// ============================================
// API Token 验证
// ============================================

const API_TOKENS = (typeof env !== 'undefined' && env.API_TOKENS) 
  ? env.API_TOKENS.split(',').filter(t => t.trim())
  : [];

function validateToken(authHeader) {
  if (API_TOKENS.length === 0) return true;
  const token = authHeader && authHeader.startsWith('Bearer ') 
    ? authHeader.slice(7).trim() 
    : '';
  return API_TOKENS.includes(token);
}

// ============================================
// API Handlers
// ============================================

async function handleModels(authHeader) {
  if (!validateToken(authHeader)) {
    return new Response(JSON.stringify({ error: { message: 'Incorrect API key provided.', type: 'invalid_request_error' } }), {
      status: 401,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });
  }

  try {
    const response = await fetch('https://chat.qwen.ai/api/models', {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      },
    });
    const data = await response.json();
    return new Response(JSON.stringify(data), {
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: { message: 'Failed to fetch models', type: 'api_error' } }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });
  }
}

async function handleChatCompletions(body, authHeader) {
  if (!validateToken(authHeader)) {
    return new Response(JSON.stringify({ error: { message: 'Incorrect API key provided.', type: 'invalid_request_error' } }), {
      status: 401,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });
  }

  const startTime = Date.now();
  
  try {
    const { model, messages, stream = true } = body;

    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return new Response(JSON.stringify({ error: { message: 'Messages are required' } }), {
        status: 400,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
      });
    }

    const actualModel = model || 'qwen3.5-plus';
    const lastUserMessage = messages.filter(m => m.role === 'user').pop();
    const userContent = lastUserMessage ? lastUserMessage.content : 'hello';
    
    const { bxUa, bxUmidToken, bxV } = await getBaxiaTokens();
    
    // 创建 chat 会话
    const createChatBody = {
      title: '新建对话',
      models: [actualModel],
      chat_mode: 'guest',
      chat_type: 't2t',
      timestamp: Date.now(),
      project_id: '',
    };
    
    const createHeaders = {
      'Accept': 'application/json, text/plain, */*',
      'Content-Type': 'application/json',
      'bx-ua': bxUa,
      'bx-umidtoken': bxUmidToken,
      'bx-v': bxV,
      'Referer': 'https://chat.qwen.ai/c/guest',
      'source': 'web',
      'x-request-id': uuidv4(),
    };
    
    const createResp = await fetch('https://chat.qwen.ai/api/v2/chats/new', {
      method: 'POST',
      headers: createHeaders,
      body: JSON.stringify(createChatBody),
    });
    
    const createData = await createResp.json();
    
    if (!createData.success || !createData.data?.id) {
      return new Response(JSON.stringify({ error: { message: 'Failed to create chat session' } }), {
        status: 500,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
      });
    }
    
    const chatId = createData.data.id;
    
    // 合并多轮对话
    let combinedContent = '';
    if (messages.length > 1) {
      const historyParts = [];
      for (let i = 0; i < messages.length - 1; i++) {
        const msg = messages[i];
        const roleLabel = msg.role === 'user' ? 'User' : 'Assistant';
        historyParts.push(`[${roleLabel}]: ${msg.content}`);
      }
      combinedContent = historyParts.join('\n\n') + '\n\n[User]: ' + messages[messages.length - 1].content;
    } else {
      combinedContent = userContent;
    }
    
    const fid = uuidv4();
    const responseFid = uuidv4();
    
    const requestBody = {
      stream: true,
      version: '2.1',
      incremental_output: true,
      chat_id: chatId,
      chat_mode: 'guest',
      model: actualModel,
      parent_id: null,
      messages: [{
        fid: fid,
        parentId: null,
        childrenIds: [responseFid],
        role: 'user',
        content: combinedContent,
        user_action: 'chat',
        files: [],
        timestamp: Date.now(),
        models: [actualModel],
        chat_type: 't2t',
        feature_config: {
          thinking_enabled: true,
          output_schema: 'phase',
          research_mode: 'normal',
          auto_thinking: true,
          thinking_format: 'summary',
          auto_search: true,
        },
        extra: { meta: { subChatType: 't2t' } },
        sub_chat_type: 't2t',
        parent_id: null,
      }],
      timestamp: Date.now(),
    };
    
    const headers = {
      'Accept': 'application/json',
      'bx-ua': bxUa,
      'bx-umidtoken': bxUmidToken,
      'bx-v': bxV,
      'Content-Type': 'application/json',
      'source': 'web',
      'version': '0.2.9',
      'x-request-id': uuidv4(),
      'Referer': 'https://chat.qwen.ai/c/guest',
    };
    
    const response = await fetch(`https://chat.qwen.ai/api/v2/chat/completions?chat_id=${chatId}`, {
      method: 'POST',
      headers,
      body: JSON.stringify(requestBody),
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      return new Response(JSON.stringify({ error: { message: errorText } }), {
        status: response.status,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
      });
    }

    // 收集完整响应
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let contentChunks = [];
    const responseId = `chatcmpl-${uuidv4()}`;
    const created = Math.floor(Date.now() / 1000);
    
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
    }
    
    const lines = buffer.split('\n');
    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      const data = line.slice(6).trim();
      if (data === '[DONE]') continue;
      
      try {
        const parsed = JSON.parse(data);
        if (parsed.choices && parsed.choices[0]?.delta?.content) {
          contentChunks.push(parsed.choices[0].delta.content);
        }
      } catch (e) {}
    }

    if (stream) {
      const streamBody = contentChunks.map((content, i) => {
        return `data: ${JSON.stringify({
          id: responseId,
          object: 'chat.completion.chunk',
          created: created,
          model: actualModel,
          choices: [{
            index: 0,
            delta: { content: content },
            finish_reason: i === contentChunks.length - 1 ? 'stop' : null,
          }],
        })}\n\n`;
      }).join('') + 'data: [DONE]\n\n';
      
      return new Response(streamBody, {
        headers: { 
          'Content-Type': 'text/event-stream', 
          'Cache-Control': 'no-cache',
          'Access-Control-Allow-Origin': '*' 
        }
      });
    } else {
      const openAI = {
        id: responseId,
        object: 'chat.completion',
        created: created,
        model: actualModel,
        choices: [{
          index: 0,
          message: { role: 'assistant', content: contentChunks.join('') },
          finish_reason: 'stop',
        }],
        usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
      };
      return new Response(JSON.stringify(openAI), {
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
      });
    }
  } catch (error) {
    return new Response(JSON.stringify({ error: { message: error.message } }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });
  }
}

// ============================================
// Worker 入口
// ============================================

export default {
  async fetch(request, env, ctx) {
    // 处理 CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        }
      });
    }

    const url = new URL(request.url);
    const path = url.pathname;
    const authHeader = request.headers.get('Authorization') || '';

    // 模型列表
    if (request.method === 'GET' && path.includes('/v1/models')) {
      return handleModels(authHeader);
    }

    // 聊天完成
    if (request.method === 'POST' && path.includes('/v1/chat/completions')) {
      const body = await request.json();
      return handleChatCompletions(body, authHeader);
    }

    // 根路径
    if (request.method === 'GET' && (path === '/' || path === '')) {
      return new Response('<html>\n<head><title>200 OK</title></head>\n<body>\n<center><h1>200 OK</h1></center>\n<hr><center>nginx</center>\n</body>\n</html>\n', {
        headers: { 'Content-Type': 'text/html' }
      });
    }

    return new Response(JSON.stringify({ error: { message: 'Not found' } }), {
      status: 404,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });
  }
};
