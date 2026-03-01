const express = require('express');
const { v4: uuidv4 } = require('uuid');

const app = express();
app.use(express.json());

// 从环境变量或直接配置获取 JWT Token
const AUTH_TOKEN = process.env.QWEN_TOKEN || `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6IjhkMTE4ZjI3LWFlNzItNDBhZC05YjIwLTY0MWMzZDAxMWVkMiIsImxhc3RfcGFzc3dvcmRfY2hhbmdlIjoxNzcyMzA0MjExLCJleHAiOjE3NzQ4OTY2NDB9.hCR1c8MfUWyIbNtrvON8jA80CyAExabdCCZDvkL_mRA`;

// 延迟加载 baxia-token 模块
let baxiaModule = null;

async function getBaxiaModule() {
  if (!baxiaModule) {
    baxiaModule = require('./baxia-token');
  }
  return baxiaModule;
}

// 延迟加载 fetch-baxia 模块
let fetchBaxiaModule = null;

async function getFetchBaxiaModule() {
  if (!fetchBaxiaModule) {
    fetchBaxiaModule = require('./fetch-baxia');
  }
  return fetchBaxiaModule;
}

// OpenAI 格式的模型列表 API
app.get('/v1/models', async (req, res) => {
  try {
    const response = await fetch('https://chat.qwen.ai/api/models', {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36',
        'Cookie': `token=${AUTH_TOKEN}`,
      },
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const data = await response.json();
    res.json(data);
  } catch (error) {
    console.error('Error fetching models:', error);
    res.status(500).json({ 
      error: { message: 'Failed to fetch models', type: 'api_error' }
    });
  }
});

// 创建新聊天会话 API（反代 https://chat.qwen.ai/api/v2/chats/new）
app.get('/api/v2/chats/new', async (req, res) => {
  try {
    const requestBody = {
      title: '新建对话',
      models: ['qwen3.5-plus'],
      chat_mode: 'guest',
      chat_type: 't2t',
      timestamp: Date.now(),
      project_id: '',
    };
    
    const headers = {
      'Accept': 'application/json, text/plain, */*',
      'Accept-Language': 'zh-CN,zh;q=0.9',
      'Connection': 'keep-alive',
      'Content-Type': 'application/json',
      'Origin': 'https://chat.qwen.ai',
      'Referer': 'https://chat.qwen.ai/c/new-chat',
      'Sec-Fetch-Dest': 'empty',
      'Sec-Fetch-Mode': 'cors',
      'Sec-Fetch-Site': 'same-origin',
      'Timezone': 'Sun Mar 01 2026 10:25:56 GMT+0800',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36',
      'X-Request-Id': '85341e15-86f2-445d-9a09-cc62834845b6',
      'bx-ua': '231!+/S3RAmUKmG+jo14dk3YfwDjU0EFbxIPhmaHlkqUue5zXG3b+3lFomgS3e54458zDKuHYed6RCYFxbi3xIH64a4UdqS75YSvKMRmt5MLmrrs0jsWwJaypbEjdQlpUg9wR5VxTQEPZBplT0xfZWUFN6GJyw0Ut4/YE51fAJDyEmxsYRUSRXE+XV4TaxXUB7ypczH9SAvq5WVKjskf9tc7Iu5vocQhWeAkCt7HL99T9m7mm0ISQ5Wp/iD+Aw8e+Zd++6WF1cGxpj2wHJBh+++j+ygU3+jOKBSInC4nFkk3HBOqypjsEnN6slgw9JhaAmJK5cPsOFomnCUy00ykPUfXgGjLSCIaDiR1vLNl7CmmfGeVIDUISp7pj2PyrGLmvX4CeyzaFE2o5VZfJqhA19zQ9+MGmSiOrYfwB+HJwrAi7hTSZnhb1PwbAu1s004gaGhzOZ5nFVH/zCh+4yffbzKz3mzY1JVE7LbzKHMvY9bsK+IltaBahCxj7mwD0eebxjBW3j7F4K9+cdxmloujV4Zz5U+qFm6FoXf+GdoObHO8p/kcACbrKi7eBztrpTzBcYADAmlWz/fkbgL5HSDrF9fjTf8xjPdN0fCDIGk++uvGg8gqyU+EpAVvbu4e90pG37wsPmnIlvZkDwZDDxmFHDojUcZEdiLUx0eW99eNZCpnrRBhPl5cNVtu9P0dLFyAti/nwK6POvd5rPTJZ+zf4mf3WtmHOXBbq3J/iCB9drdS/tSxuPxzbU7eW2wU8ur0XNw4UiYCWOKDchOBPJMmgFAEKN6szMD6D42bEjYakLOilwDwiw/A2W7CgtSFJawHPChL3YwYK82/cdlowslK21zuevvE28ZpwHViRE8azvTNV3pFwbNWXHsoEJprDv0fqEbADP5sYF4s8KEcwWmvYRUCUtrEhXReQgxVU34uKXcIaf4csBaEv7oirvHUPdLeq2DdBVLfVmknEdUIJyw20KoocCr0Z3OKrU3VnBeHFWWFLTteCotIUamErcYeey9xZMWgRvN+HBuevQMdwIaylm3f7i5l6ldlq6VehDpJ65C4yYH4B7TmsHyjkBbK9clExoJ6EAP6EgYwFZq7XJQMFb2+uElKepDXHtsdCnPkGQfBOz0BFeX94+Ntcudt+5GcAsL+pQty0vehOqOKcHOecHqBvZox5uKirPBRTdOOU1n6UhOw1WuknxFjFQmilnPlHMEv7+CNWM3HuG+QWPaSWAtf3IrI5ZrSWdbEP050cN12BgKg5Kgu2NbsTg65CElDH9BT5IWoA7fpDzjgEikwZ9vSF3HpmmIefgn0oPdh/EvifgcZU/lvIDo7AyPMHli0atbtJbRYMVLRAdcrA66kwiOfz3Avir2rxfsnQwyRCESaeZRbqUEtucDqhY8KoKRd697YLfY+5mF3gMgKRCBldd7zd9TGUjdHeFmnzZEW8nrCv6p2JaP9dnW3/C4OZ+k2+HchpfyiQFBctlMRotTnlzLG',
      'bx-umidtoken': 'T2gA2jy2dTB4RcZ0JpfukTwnTuEcoMAMaB2ysHhKFCYa4TH17H9JKn5uzm2EWcR5VSQ=',
      'sec-ch-ua': '"Not:A-Brand";v="99", "Google Chrome";v="145", "Chromium";v="145"',
      'sec-ch-ua-mobile': '?0',
      'sec-ch-ua-platform': '"Windows"',
      'source': 'web',
    };
    
    const response = await fetch('https://chat.qwen.ai/api/v2/chats/new', {
      method: 'POST',
      headers,
      body: JSON.stringify(requestBody),
    });
    
    const data = await response.json();
    res.status(response.status).json(data);
  } catch (error) {
    console.error('Error creating chat:', error);
    res.status(500).json({ 
      error: { message: error.message, type: 'api_error' }
    });
  }
});

// OpenAI 格式的聊天完成 API
app.post('/v1/chat/completions', async (req, res) => {
  try {
    const { model, messages, stream = true } = req.body;

    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ 
        error: { message: 'Messages are required', type: 'invalid_request_error' }
      });
    }

    const actualModel = model || 'qwen3.5-plus';
    const chatId = 'd7ec7df0-cfd9-433e-8f3c-c5a6a3e6b51b';
    
    // 获取最后一条用户消息
    const lastUserMessage = messages.filter(m => m.role === 'user').pop();
    const userContent = lastUserMessage ? lastUserMessage.content : 'hello';
    
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
        content: userContent,
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
      'bx-ua': '231!cI+3t4mUIyk+jov+K5gCZ48FEl2ZWfPwIPF92lBLek2KxVW/XJ2EwruCiDOX5Px4EXNhmh6EfS9eDwQGRwijIK64A4nPqeLysJcDjUACje/H3J4ZgGZpicG6K8AkiGGBTy2jws7Q+iSU6+M5Sr2nhdTZYQJc/5iDkQsOUcC2uxY+gX/wWKMx3km+0Q3oyE+jauHhUlK48RxGHkE+++3+qCS4+ItNXk6rAojCo+nHZPEq4IaVJuxxyGOEGWL+/sqh26VlXJO1W4XEfcRRg30yO+I7FzJ+t3492zZsQJ/UY1cp0BQHO3+OcbvtBQuCvcyOC6iR0vLipyoW1X4IlPU2g6wC4iw320CGOjUray0rzqtzbawtG81RVpXRk0ETmG6OCGq1P+JtaP+S49POQ93tqysOucfydh3O0VPfJHmNxSuRfJyuqwaZ7Ch9fgWw+UiPrxSk4U09W9OaR5A0P4T4PpHouWbvYitghHlwuMDW/nwH5ME2S41i4E+IpAQe+ymCFOnVWxN+OGePOfK3zxaShsGSeyAvLxG0pw9yBwHF1MSHQiFxcC0ccKTZVSg5wcxjrFrS2+qkBinCcn07yn0jrCcK2RqkDQvYKn0nGo313dqSnxXwI5yZot9yaVrUcrcC0bTe+6Z7yAYZgEjrgjLkD1700KgFGKFcjtwn5uk7x+cQpUY+mUPBdfS/XhZzgTA/X6tKT4q9+WUKRx+FY125mFk/qbXP/WIEYeasC1HDF+2pSGvU9vSW/3G6gmvdU9Fn2Vw5LEZ0mESeUbcB11BREIzCUcwJNWn60jWUxdkcFYQC7S//HjnSRlq2HdRsJqs3vHbSEtaJQydGfSIMR49l49iDKOJtSEAF+zaZ3O1hQ4hSNakpGgkVTyL/8UgNM3vYF6RvrAPoRzrKKqYPFRQU9VXT2gBMboMAepPrTCGuqPRcCd3yOlZqlXX6TYMsuAkHenjET90tJZvu3mLQ81NM0XJ961lKtZUb9x7ASsKcPl7P9QfwG9+1P+kF/uTrSwawtNf1DvPu4tKil5BJicQyxrzy0lPl5a/1huJG7MywJPa7PoiBxHIDk8xsP6ckR/F6YmVUsHkB6+F2CphUJc6wLlNVx+HYYBMYAvPUk8mvPujn+tisAoCWVF5pwVrn6MyW75g78wAE9Yshdvfqns4atiz7i9UCsfQz0WZ+4+IODLbLAHlQoweaAdWdjJ4ELwm88Hu13Wb8y1TdFrGOFD5wO3Smn4/phn4vJ2YqmQ2b4hH2HHJetE1ZVZKJ5UHOQLysnzCUFT09/ZgUea2bRrCJgxvIU/tNdbRTEjI1hUBShnycuW3HUaoExQloXD5NHNvY8+gQdqnY9fVmRwbuz1XJvahgJohNpUM0Xc5BZzoevzP9fU3p3ACwJIorGZhU+6mljvfakPLPMOtU7W1M/uh8bsNia+BJiVaZRQ3xc7NDO+i9zgNOzNIHpXwudJQ0zkFLCj89g3WwjAkUR4DfREdQevB=',
      'bx-umidtoken': 'T2gA2jy2dTB4RcZ0JpfukTwnTuEcoMAMaB2ysHhKFCYa4TH17H9JKn5uzm2EWcR5VSQ=',
      'bx-v': '2.5.36',
      'Content-Type': 'application/json',
      'sec-ch-ua': '"Not:A-Brand";v="99", "Google Chrome";v="145", "Chromium";v="145"',
      'sec-ch-ua-mobile': '?0',
      'sec-ch-ua-platform': '"Windows"',
      'sec-fetch-dest': 'empty',
      'sec-fetch-mode': 'cors',
      'sec-fetch-site': 'same-origin',
      'source': 'web',
      'timezone': new Date().toUTCString(),
      'x-accel-buffering': 'no',
      'x-request-id': uuidv4(),
      'Cookie': `_gcl_au=1.1.2040236964.1771812821; _bl_uid=32m7bl3LyUsj2klkUwgec8L7b14p; cna=26UiIj2An1ICAWgcmKtujklv; xlly_s=1; x-ap=cn-hongkong; sca=b1e049e0; acw_tc=0a03e59417723333657876112e2a588932916e1aee5124fbb2c2f321f1572b; atpsida=5120ea96e20bebafe1e14d21_1772333439_7; tfstk=gF1EK6_FDWFeLaZcuZAzgGbdaFdpGQrba_tWrabkRHx3v_Oyrh7rA9_5rQPyjgKhAeapqUAd19GWAkdPriOzcoNbGwQpeQqbc54znFADl30nVHbijQTzjh0NowQpwVEdrr_dJ7ruYuTHZgAMjU8HZDYlqCAMohcHrXYojP8JjQYoKQcisEYEqYclqN4wyhxkZpjksP8Jj3AkZbAvqnGwup4nBgc3sWwkQnbHbbcqkFJn4wMSwbCw8pJhSh86518eLnJzlZENtG_lO6pTIARR5tSPEgejBB7lKBYfJWlwiwX1aF17PY-hv17GOdujGiRF4KfHQ4cy9BxM_Ff0PxK1_HslTd4jgLOGGKAhCREBFB8Vq6IEzbjc5Z1pB_rqj3BBkCYfJWlwiwYl4rmJSCUGw9ooUpY97naa74mFUe00jyEjeYpdBF-bJyH-epY97naa7YHJpCLwcyUd.; isg=BPT0Jsd4IYSjYbXwiZyNWpVlxbJmzRi3Rffl_I5UxX8C-ZdDst-JRpn_eTEhWVAP; ssxmod_itna=1-Yq0xyQ0QDQING0D2DRxQKhDAx7weWu4iODzxCvYG7DuxiK08D6QDBb46eHdEnTRs4tKmmBqEeKBxGNimDA5Dn_x7YDtr3IK4dBoC25ib7t0DPol/eWoxt8WRgqxpK7ACh1IEpu/TzceRxNUmGdDU4GnD06eKAdbDYAfDBYD74G_DDeDiE3Dj4GmDGANseDF0nTroPToPxDwDB=Dmu4r0eDEDG3D04uxFGwP9CxD0khwHi4HxxGW0QnqpaedDGUe4a4o0eDMFxGX/0khxDUXqshTqZSjOFoohPFDtqD9jZue6GI=T1n5O/AxAeKr4UWDbn5_Yx4ix=jGGAxzihNix30hxAx3mmNlLilhGpmueb4b4DnnYg4xYhKRxozvlf5IUH/Yr3MhGenrii0lBxAD8BhN/hK8BDBGNv7PcD49YN3YPeD; ssxmod_itna2=1-Yq0xyQ0QDQING0D2DRxQKhDAx7weWu4iODzxCvYG7DuxiK08D6QDBb46eHdEnTRs4tKmmBqEeKYxAobdYclg4tOQmDDsbYC12D=s03ojcP8Ql=l_6hEGpuDbeGSeeNsVnAhd53RhIAEDD; token=${AUTH_TOKEN}`,
      'Referer': 'https://chat.qwen.ai/c/guest',
    };
    
    console.log(`[API] Chat request: model=${actualModel}, stream=${stream}`);
    
    const response = await fetch(`https://chat.qwen.ai/api/v2/chat/completions?chat_id=${chatId}`, {
      method: 'POST',
      headers,
      body: JSON.stringify(requestBody),
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      console.error('[API] Chat error:', response.status, errorText);
      return res.status(response.status).json({ 
        error: { message: errorText, type: 'api_error' }
      });
    }

    if (stream) {
      // 流式响应
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      const responseId = `chatcmpl-${uuidv4()}`;
      const created = Math.floor(Date.now() / 1000);
      
      let buffer = '';
      
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          
          const data = line.slice(6).trim();
          if (data === '[DONE]') {
            res.write('data: [DONE]\n\n');
            continue;
          }
          
          try {
            const parsed = JSON.parse(data);
            
            // 转换为 OpenAI 格式
            const openAIChunk = {
              id: responseId,
              object: 'chat.completion.chunk',
              created: created,
              model: actualModel,
              choices: [{
                index: 0,
                delta: {},
                finish_reason: null,
              }],
            };
            
            if (parsed.choices && parsed.choices[0]) {
              const choice = parsed.choices[0];
              
              if (choice.delta && choice.delta.content) {
                openAIChunk.choices[0].delta = {
                  content: choice.delta.content,
                };
                // 打印流式内容
                process.stdout.write(choice.delta.content);
              }
              
              if (choice.finish_reason) {
                openAIChunk.choices[0].finish_reason = choice.finish_reason;
                console.log(`\n[API] Stream finished with reason: ${choice.finish_reason}`);
              }
            }
            
            res.write(`data: ${JSON.stringify(openAIChunk)}\n\n`);
          } catch (e) {
            // 忽略解析错误
          }
        }
      }
      
      res.write('data: [DONE]\n\n');
      res.end();
    } else {
      // 非流式响应 - 读取所有数据
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let contentChunks = [];
      
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
      
      const openAI = {
        id: `chatcmpl-${uuidv4()}`,
        object: 'chat.completion',
        created: Math.floor(Date.now() / 1000),
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
      
      res.json(openAI);
    }
  } catch (error) {
    console.error('Error in chat completions:', error);
    res.status(500).json({ 
      error: { message: error.message, type: 'internal_error' }
    });
  }
});

// 健康检查
app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

// 根路径
app.get('/', (req, res) => {
  res.json({
    message: 'Qwen to OpenAI API Proxy (with Baxia bypass)',
    version: '3.0.0',
    backend: 'Using Puppeteer to bypass Baxia',
    endpoints: {
      models: '/v1/models',
      chat: '/v1/chat/completions',
    },
    note: 'This version uses Puppeteer to handle Baxia security automatically',
  });
});

const PORT = process.env.PORT || 8765;
app.listen(PORT, '127.0.0.1', () => {
  console.log(`Qwen2API server running on port ${PORT}`);
  console.log(`API endpoint: http://localhost:${PORT}/v1/chat/completions`);
  console.log(`Note: First request will launch a headless browser`);
}).on('error', (err) => {
  console.error('Server error:', err);
});
