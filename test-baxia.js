/**
 * 测试 Baxia Token 获取
 */

const { getBaxiaTokens, closeBrowser } = require('./baxia-token');

async function main() {
  try {
    console.log('=== Testing Baxia Token Fetch ===\n');
    
    const tokens = await getBaxiaTokens();
    
    console.log('\n=== Results ===');
    console.log('bx-ua:', tokens.bxUa.substring(0, 100) + '...');
    console.log('bx-ua length:', tokens.bxUa.length);
    console.log('\nbx-umidtoken:', tokens.bxUmidToken);
    console.log('\nbx-v:', tokens.bxV);
    
    console.log('\n=== Full bx-ua ===');
    console.log(tokens.bxUa);
    
  } catch (error) {
    console.error('Error:', error);
  } finally {
    await closeBrowser();
  }
}

main();
