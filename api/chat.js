const { v4: uuidv4 } = require('uuid');
const { getBaxiaTokensUniversal } = require('../baxia-node');

// API Token 配置 (从环境变量获取，多个 token 用逗号分隔)
const API_TOKENS = (process.env.API_TOKENS || 'auto').split(',').filter(t => t.trim());

// Token 验证中间件 (OpenAI 兼容格式: Authorization: Bearer <token>)
function validateToken(authHeader) {
  // 如果没有配置 token，跳过验证
  if (API_TOKENS.length === 0) {
    return true;
  }
  
  const token = authHeader && authHeader.startsWith('Bearer ') 
    ? authHeader.slice(7).trim() 
    : '';
  
  return API_TOKENS.includes(token);
}

// 创建标准响应
function createResponse(body, status = 200, headers = {}) {
  return {
    statusCode: status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      ...headers,
    },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  };
}

// 创建流式响应 (用于 Vercel/Netlify)
function createStreamResponse(stream, headers = {}) {
  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*',
      ...headers,
    },
    body: stream,
  };
}

// OpenAI 格式的模型列表 API
async function handleModels(authHeader) {
  if (!validateToken(authHeader)) {
    return createResponse({
      error: {
        message: 'Incorrect API key provided.',
        type: 'invalid_request_error',
        code: 'invalid_api_key'
      }
    }, 401);
  }

  try {
    const response = await fetch('https://chat.qwen.ai/api/models', {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      },
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const data = await response.json();
    return createResponse(data);
  } catch (error) {
    console.error('Error fetching models:', error);
    return createResponse({ 
      error: { message: 'Failed to fetch models', type: 'api_error' }
    }, 500);
  }
}

// OpenAI 格式的聊天完成 API
async function handleChatCompletions(body, authHeader) {
  if (!validateToken(authHeader)) {
    return createResponse({
      error: {
        message: 'Incorrect API key provided.',
        type: 'invalid_request_error',
        code: 'invalid_api_key'
      }
    }, 401);
  }

  const startTime = Date.now();
  
  try {
    const { model, messages, stream = true } = body;

    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return createResponse({ 
        error: { message: 'Messages are required', type: 'invalid_request_error' }
      }, 400);
    }

    const actualModel = model || 'qwen3.5-plus';
    
    // 获取最后一条用户消息
    const lastUserMessage = messages.filter(m => m.role === 'user').pop();
    const userContent = lastUserMessage ? lastUserMessage.content : 'hello';
    
    // 获取 baxia tokens
    const { bxUa, bxUmidToken, bxV } = await getBaxiaTokensUniversal({ silent: true });
    console.log(`[Step 1] Get baxia tokens: ${Date.now() - startTime}ms`);
    
    // 创建新的 chat 会话
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
      'timezone': new Date().toUTCString(),
      'x-request-id': uuidv4(),
    };
    
    const createResponse = await fetch('https://chat.qwen.ai/api/v2/chats/new', {
      method: 'POST',
      headers: createHeaders,
      body: JSON.stringify(createChatBody),
    });
    
    const createData = await createResponse.json();
    console.log(`[Step 2] Create chat session: ${Date.now() - startTime}ms`);
    
    if (!createData.success || !createData.data?.id) {
      return createResponse({ 
        error: { message: 'Failed to create chat session', details: createData }
      }, 500);
    }
    
    const chatId = createData.data.id;
    
    // 将多轮对话合并成一个消息
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
        extra: {
          meta: {
            subChatType: 't2t',
          },
        },
        sub_chat_type: 't2t',
        parent_id: null,
      }],
      timestamp: Date.now(),
    };
    
    const headers = {
      'Accept': 'application/json',
      'Accept-Language': 'zh-CN,zh;q=0.9',
      'bx-ua': bxUa,
      'bx-umidtoken': bxUmidToken,
      'bx-v': bxV,
      'Content-Type': 'application/json',
      'sec-ch-ua': '"Not:A-Brand";v="99", "Google Chrome";v="145", "Chromium";v="145"',
      'sec-ch-ua-mobile': '?0',
      'sec-ch-ua-platform': '"Windows"',
      'sec-fetch-dest': 'empty',
      'sec-fetch-mode': 'cors',
      'sec-fetch-site': 'same-origin',
      'source': 'web',
      'version': '0.2.9',
      'timezone': new Date().toUTCString(),
      'x-accel-buffering': 'no',
      'x-request-id': uuidv4(),
      'Cookie': '',
      'Referer': 'https://chat.qwen.ai/c/guest',
    };
    
    // 发送聊天请求
    const response = await fetch(`https://chat.qwen.ai/api/v2/chat/completions?chat_id=${chatId}`, {
      method: 'POST',
      headers,
      body: JSON.stringify(requestBody),
    });
    console.log(`[Step 3] Send chat request: ${Date.now() - startTime}ms`);
    
    if (!response.ok) {
      const errorText = await response.text();
      console.error('[API] Chat error:', response.status, errorText);
      return createResponse({ 
        error: { message: errorText, type: 'api_error' }
      }, response.status);
    }

    // 对于 Serverless 环境，收集完整响应
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let contentChunks = [];
    const responseId = `chatcmpl-${uuidv4()}`;
    const created = Math.floor(Date.now() / 1000);
    
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        console.log(`[Done] Total time: ${Date.now() - startTime}ms`);
        break;
      }
      
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
      // 返回模拟流式响应 (Serverless 环境通常不支持真正的流式)
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
      
      return createStreamResponse(streamBody);
    } else {
      // 非流式响应
      const openAI = {
        id: responseId,
        object: 'chat.completion',
        created: created,
        model: actualModel,
        choices: [{
          index: 0,
          message: {
            role: 'assistant',
            content: contentChunks.join(''),
          },
          finish_reason: 'stop',
        }],
        usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
      };
      
      return createResponse(openAI);
    }
  } catch (error) {
    console.error('Error in chat completions:', error);
    return createResponse({ 
      error: { message: error.message, type: 'internal_error' }
    }, 500);
  }
}

// 主处理函数 - Vercel/Netlify 格式
module.exports = async function handler(req, res) {
  // 处理 CORS preflight
  if (req.method === 'OPTIONS') {
    return res ? res.status(200).end() : createResponse('', 200);
  }
  
  const authHeader = req.headers?.authorization || req.headers?.Authorization || '';
  
  // 路由处理
  const path = req.url || req.path || '';
  
  // 模型列表
  if (req.method === 'GET' && path.includes('/v1/models')) {
    const result = await handleModels(authHeader);
    if (res) {
      return res.status(result.statusCode).set(result.headers).send(result.body);
    }
    return result;
  }
  
  // 聊天完成
  if (req.method === 'POST' && path.includes('/v1/chat/completions')) {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    const result = await handleChatCompletions(body, authHeader);
    if (res) {
      return res.status(result.statusCode).set(result.headers).send(result.body);
    }
    return result;
  }
  
  // 根路径
  if (req.method === 'GET' && (path === '/' || path.endsWith('/'))) {
    const html = '<html>\n<head><title>200 OK</title></head>\n<body>\n<center><h1>200 OK</h1></center>\n<hr><center>nginx</center>\n</body>\n</html>\n';
    if (res) {
      return res.status(200).send(html);
    }
    return createResponse(html, 200, { 'Content-Type': 'text/html' });
  }
  
  // 404
  const notFound = { error: { message: 'Not found', type: 'not_found' } };
  if (res) {
    return res.status(404).json(notFound);
  }
  return createResponse(notFound, 404);
};

// 导出子路由处理函数
module.exports.handleModels = handleModels;
module.exports.handleChatCompletions = handleChatCompletions;
module.exports.createResponse = createResponse;
