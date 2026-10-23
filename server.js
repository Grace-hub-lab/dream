// 解梦 PWA 后端：静态文件服务 + 大模型 API 代理（零依赖，Node 18+）
// API key 只保存在服务端 .env 中，前端永远拿不到。
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// ---------- 读取 .env ----------
function loadEnv(file) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!m || line.trim().startsWith('#')) continue;
    let val = m[2].replace(/^["']|["']$/g, '');
    if (!(m[1] in process.env)) process.env[m[1]] = val;
  }
}
loadEnv(path.join(__dirname, '.env'));

const PORT = Number(process.env.PORT) || 3000;
const API_KEY = process.env.API_KEY || '';
const BASE_URL = (process.env.BASE_URL || 'https://api.deepseek.com/v1').replace(/\/+$/, '');
const MODEL = process.env.MODEL || 'deepseek-chat';
// 访问密码：设置后，前端必须带正确密码才能调用解梦接口（部署到公网时务必设置）
const ACCESS_CODE = process.env.ACCESS_CODE || '';
const PUBLIC_DIR = path.join(__dirname, 'public');
const MAX_DREAM_LEN = 3000;

// ---------- 提示词 ----------
const STYLE_PROMPTS = {
  psych: '请主要从现代心理学角度（荣格原型与集体无意识、弗洛伊德的愿望满足、认知/情绪加工理论）进行解读。',
  zhougong: '请主要从中国传统《周公解梦》及民俗文化角度进行解读，并说明这是传统说法、仅供娱乐参考。',
  both: '请同时给出现代心理学角度（荣格、弗洛伊德、情绪加工）和中国传统《周公解梦》角度的解读，两部分分开写。',
};

function buildMessages(dream, style, mood) {
  const system = [
    '你是一位温和、专业、富有洞察力的解梦师。',
    '用户会描述自己的梦，你需要用中文给出结构清晰的解读，使用 Markdown 格式，包含以下小节（用 ### 作为小标题）：',
    '### 梦境概括（一两句话）',
    '### 关键意象（列出梦中重要的符号及其可能含义）',
    '### 深度解读',
    '### 与现实的联系（结合用户情绪，提出 2-3 个可以自我反思的问题）',
    '### 温馨建议',
    STYLE_PROMPTS[style] || STYLE_PROMPTS.both,
    '语气要温暖、不下绝对结论，避免制造焦虑；不要做任何医疗诊断。',
    '如果梦境内容显示用户可能有严重的心理困扰或自我伤害倾向，要温和地建议其寻求专业心理帮助。',
    '如果用户输入的内容明显不是梦境描述，请礼貌地引导其描述梦境。',
  ].join('\n');
  const user = `我的梦：\n${dream}` + (mood ? `\n\n醒来后的感受：${mood}` : '');
  return [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ];
}

// ---------- 简易限流：每 IP 每分钟 10 次 ----------
const hits = new Map();
function rateLimited(ip) {
  const now = Date.now();
  const list = (hits.get(ip) || []).filter((t) => now - t < 60_000);
  list.push(now);
  hits.set(ip, list);
  return list.length > 10;
}
// 定期清理过期记录，避免内存增长
setInterval(() => {
  const now = Date.now();
  for (const [ip, list] of hits) if (list.every((t) => now - t >= 60_000)) hits.delete(ip);
}, 5 * 60_000).unref();

// 部署在平台反向代理后面时，真实 IP 在 X-Forwarded-For 里
function clientIp(req) {
  const fwd = req.headers['x-forwarded-for'];
  if (typeof fwd === 'string' && fwd) return fwd.split(',')[0].trim();
  return req.socket.remoteAddress || 'unknown';
}

// 常量时间比较，防止通过响应时间猜密码
function codeMatches(given) {
  if (typeof given !== 'string') return false;
  const a = crypto.createHash('sha256').update(given).digest();
  const b = crypto.createHash('sha256').update(ACCESS_CODE).digest();
  return crypto.timingSafeEqual(a, b);
}

// ---------- 工具函数 ----------
function sendJson(res, status, obj) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(obj));
}

function readBody(req, limit = 20_000) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => {
      data += chunk;
      if (data.length > limit) {
        reject(new Error('请求体过大'));
        req.destroy();
      }
    });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

// ---------- /api/interpret：流式返回解读文本 ----------
async function handleInterpret(req, res) {
  if (rateLimited(clientIp(req))) return sendJson(res, 429, { error: '请求太频繁了，休息一分钟再试吧' });
  if (ACCESS_CODE) {
    const given = req.headers['x-access-code'];
    // 中文密码在前端经过 encodeURIComponent 编码
    let decoded = '';
    try { decoded = decodeURIComponent(typeof given === 'string' ? given : ''); } catch { /* 非法编码视为错误 */ }
    if (!codeMatches(decoded)) {
      return sendJson(res, 401, { error: given ? '访问密码不对，请重新输入' : '请输入访问密码', code: 'NEED_CODE' });
    }
  }
  if (!API_KEY) return sendJson(res, 500, { error: '服务端未配置 API_KEY，请在 .env 中填写' });

  let payload;
  try {
    payload = JSON.parse(await readBody(req));
  } catch {
    return sendJson(res, 400, { error: '请求格式错误' });
  }

  const dream = typeof payload.dream === 'string' ? payload.dream.trim() : '';
  const style = ['psych', 'zhougong', 'both'].includes(payload.style) ? payload.style : 'both';
  const mood = typeof payload.mood === 'string' ? payload.mood.trim().slice(0, 50) : '';
  if (dream.length < 5) return sendJson(res, 400, { error: '梦境描述太短了，多写一点细节吧' });
  if (dream.length > MAX_DREAM_LEN) return sendJson(res, 400, { error: `梦境描述请控制在 ${MAX_DREAM_LEN} 字以内` });

  const controller = new AbortController();
  // 注意：要监听 res 的 close，req 的 close 在请求体读完后就会触发
  res.on('close', () => controller.abort());

  let upstream;
  try {
    upstream = await fetch(`${BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${API_KEY}` },
      body: JSON.stringify({
        model: MODEL,
        messages: buildMessages(dream, style, mood),
        temperature: 0.8,
        stream: true,
      }),
      signal: controller.signal,
    });
  } catch (err) {
    console.error('上游请求失败:', err.message);
    return sendJson(res, 502, { error: '连接大模型服务失败，请检查网络或 BASE_URL' });
  }

  if (!upstream.ok) {
    const text = await upstream.text().catch(() => '');
    console.error(`上游返回 ${upstream.status}:`, text.slice(0, 500));
    const msg = upstream.status === 401 ? 'API key 无效，请检查 .env' : `大模型服务出错（${upstream.status}）`;
    return sendJson(res, 502, { error: msg });
  }

  // 把上游 SSE 转成纯文本流发给前端
  res.writeHead(200, {
    'Content-Type': 'text/plain; charset=utf-8',
    'Cache-Control': 'no-cache',
    'X-Content-Type-Options': 'nosniff',
  });

  const decoder = new TextDecoder();
  let buffer = '';
  try {
    for await (const chunk of upstream.body) {
      buffer += decoder.decode(chunk, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop();
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('data:')) continue;
        const data = trimmed.slice(5).trim();
        if (data === '[DONE]') continue;
        try {
          const delta = JSON.parse(data).choices?.[0]?.delta?.content;
          if (delta) res.write(delta);
        } catch {
          /* 忽略不完整的行 */
        }
      }
    }
  } catch (err) {
    if (err.name !== 'AbortError') console.error('流读取出错:', err.message);
  }
  res.end();
}

// ---------- 静态文件 ----------
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

function serveStatic(req, res) {
  let urlPath;
  try {
    urlPath = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  } catch {
    res.writeHead(400);
    return res.end();
  }
  if (urlPath === '/') urlPath = '/index.html';
  const filePath = path.normalize(path.join(PUBLIC_DIR, urlPath));
  // 防止目录穿越
  if (!filePath.startsWith(PUBLIC_DIR + path.sep)) {
    res.writeHead(403);
    return res.end('Forbidden');
  }
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('Not Found');
    }
    const ext = path.extname(filePath);
    const headers = { 'Content-Type': MIME[ext] || 'application/octet-stream' };
    // sw.js 与 html 不缓存，保证更新能及时生效
    if (ext === '.html' || urlPath === '/sw.js') headers['Cache-Control'] = 'no-cache';
    res.writeHead(200, headers);
    res.end(data);
  });
}

const server = http.createServer((req, res) => {
  // 前端用它判断是否显示「AI 深度解读」按钮
  if (req.method === 'GET' && req.url === '/api/health') {
    return sendJson(res, 200, { ai: !!API_KEY, needCode: !!ACCESS_CODE });
  }
  if (req.method === 'POST' && req.url === '/api/interpret') {
    handleInterpret(req, res).catch((err) => {
      console.error(err);
      if (!res.headersSent) sendJson(res, 500, { error: '服务器内部错误' });
      else res.end();
    });
    return;
  }
  if (req.method === 'GET' || req.method === 'HEAD') return serveStatic(req, res);
  res.writeHead(405);
  res.end();
});

server.listen(PORT, () => {
  console.log(`🌙 解梦服务已启动：http://localhost:${PORT}`);
  console.log(`   模型：${MODEL} @ ${BASE_URL}`);
  if (!API_KEY) console.warn('   ⚠️  未配置 API_KEY，请复制 .env.example 为 .env 并填写');
  console.log(`   访问密码：${ACCESS_CODE ? '已启用' : '未启用（部署到公网前请设置 ACCESS_CODE）'}`);
});
