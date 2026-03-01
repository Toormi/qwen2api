const handler = require('../index.js');

exports.handler = async (event, context) => {
  // 转换 Netlify 事件格式为标准格式
  const req = {
    method: event.httpMethod,
    headers: event.headers || {},
    body: event.body ? (event.isBase64Encoded ? Buffer.from(event.body, 'base64').toString() : event.body) : {},
    url: event.path,
    path: event.path,
    query: event.queryStringParameters || {},
  };

  // 创建响应对象
  let responseResult = null;
  const res = {
    status: (code) => ({
      set: (headers) => ({
        send: (body) => {
          responseResult = { statusCode: code, headers, body };
          return responseResult;
        },
        json: (body) => {
          responseResult = { statusCode: code, headers, body: JSON.stringify(body) };
          return responseResult;
        },
        end: () => {
          responseResult = { statusCode: code, headers: {}, body: '' };
          return responseResult;
        }
      }),
      json: (body) => {
        responseResult = { statusCode: code, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
        return responseResult;
      },
      send: (body) => {
        responseResult = { statusCode: code, headers: { 'Content-Type': 'text/html' }, body };
        return responseResult;
      }
    }),
    set: (headers) => ({
      send: (body) => {
        responseResult = { statusCode: 200, headers, body };
        return responseResult;
      }
    })
  };

  // 调用 handler
  await handler(req, res);

  // 返回 Netlify 格式响应
  return responseResult || { statusCode: 404, body: 'Not Found' };
};
