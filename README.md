# 🌙 梦境解析 PWA

手机优先的解梦小应用，可安装到主屏幕：

- **词典解梦（免费、离线可用）**：内置 160+ 常见梦境意象，每条包含周公解梦说法和心理学解释，输入梦境秒出结果
- **AI 深度解读（可选）**：结合整个梦的情节分析，调用大模型（默认 DeepSeek），每次约几分钱
- **词典页**：按分类浏览或搜索意象
- **梦境日记**：只保存在手机本地

## 本地运行

```powershell
Copy-Item .env.example .env   # 填入 API_KEY（不填也能用词典功能）
npm start                     # 需要 Node 18+，无需 npm install
```

打开 http://localhost:3000

## 部署方式

### A. GitHub Pages（免费，只有词典功能）

仓库需为 Public（免费账号的 Pages 不支持私有仓库）。

1. 仓库 Settings → Pages → Source 选 **GitHub Actions**
2. 推送到 main 后自动发布到 `https://<用户名>.github.io/dream/`

没有后端时，AI 按钮会自动隐藏。

### B. Render / Zeabur 等（带 AI）

在平台的环境变量里配置（不要上传 `.env`）：

| 变量 | 说明 |
|---|---|
| `API_KEY` | 大模型 API key |
| `ACCESS_CODE` | 访问密码，公网部署**必须设置** |
| `BASE_URL` / `MODEL` | 可选，默认 DeepSeek |

启动命令 `npm start`，端口由平台通过 `PORT` 注入。

## 维护

- 词典在 `public/dict.js`，格式 `[名称, 别名(|分隔), 分类, 传统说法, 心理学解释]`。别名里的 `*` 是通配（如 `被*追` 匹配「被狗追」）
- 修改 `public/` 下文件后，把 `public/sw.js` 里的 `VERSION` 加 1，已安装的 PWA 会自动更新
- `npm run icons` 重新生成图标

## 隐私

日记只保存在浏览器本地（localStorage）。只有点「AI 深度解读」时，梦境文本才会发送给大模型服务商。
