# 🌙 梦境解析 PWA

把梦描述给 AI，得到心理学 / 周公解梦角度的解读。可安装到手机主屏幕，带本地梦境日记。

## 启动

1. 复制配置文件并填入 API key：
   ```powershell
   Copy-Item .env.example .env
   notepad .env
   ```
   支持任何兼容 OpenAI 接口的服务（DeepSeek / 通义千问 / OpenAI / Kimi 等），改 `BASE_URL` 和 `MODEL` 即可。

2. 启动（需要 Node 18+，无需 npm install）：
   ```powershell
   npm start
   ```

3. 浏览器打开 http://localhost:3000

## 手机上使用

- 同一 WiFi 下：手机浏览器访问 `http://电脑IP:3000` 可以用，但 PWA 安装和 Service Worker 要求 HTTPS（localhost 除外）。
- 要真正"添加到主屏幕"，需要部署到 HTTPS 域名（如 Zeabur、Render、Railway、自己的服务器 + Nginx）。

## 部署到云平台

在平台的「环境变量」里配置（不要上传 `.env`）：

| 变量 | 说明 |
|---|---|
| `API_KEY` | 大模型 API key |
| `ACCESS_CODE` | 访问密码，公网部署**必须设置** |
| `BASE_URL` / `MODEL` | 可选，默认 DeepSeek |

启动命令 `npm start`，端口由平台通过 `PORT` 注入。

## 目录

```
server.js              后端：静态文件 + 大模型代理（API key 只在服务端）
public/                前端 PWA
  index.html / style.css / app.js
  manifest.webmanifest / sw.js
  icons/               图标（npm run icons 重新生成）
scripts/make-icons.js  图标生成脚本
```

## 更新前端后

修改 `public/` 下文件后，把 `public/sw.js` 里的 `VERSION` 加 1，已安装的 PWA 下次打开会自动刷新到新版本。

## 隐私

梦境日记只保存在浏览器本地（localStorage），服务端不存储任何内容；梦境文本会发送给你配置的大模型服务商。
