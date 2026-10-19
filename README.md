# Claude Joint Decision

一個 Codex plugin（MCP server + skill），讓 Codex 在修改內容前後徵詢 Claude 的獨立第二意見。提供兩個唯讀 MCP tools：

- `claude_joint_decision`：修改前的方案與風險第二意見
- `claude_review_diff`：修改後的 diff 與測試結果審查

Claude 只讀取工具傳入的文字，不會修改檔案或執行命令；Codex 保留最終決策權。送出前會對 Bearer token、`sk-` key 與 `*_KEY/TOKEN/SECRET/PASSWORD=` 形式的內容做基本遮罩。

## 需求

- Node.js 18 以上（使用內建 `fetch`，無其他依賴）
- 一個提供 OpenAI-compatible `/chat/completions` 的 Claude endpoint（Anthropic 的 OpenAI SDK 相容端點，或你自己的 gateway）

## 設定

| 環境變數 | 用途 | 預設 |
|---|---|---|
| `JOINT_DECISION_API_KEY` | API key | 無；未設定時讀 credential 檔 |
| `JOINT_DECISION_BASE_URL` | OpenAI-compatible base URL | `https://api.anthropic.com/v1` |
| `JOINT_DECISION_MODEL` | 模型名稱 | `claude-opus-5` |
| `JOINT_DECISION_CREDENTIALS` | credential 檔路徑 | `~/.config/claude-joint-decision/credentials.json` |

### 設定 credential（Windows）

```powershell
& ".\scripts\setup-credential.ps1"
```

腳本會以不回顯方式讀取 key，寫入 credential 檔並限制為目前使用者可讀寫。也可以直接使用環境變數：

```powershell
$env:JOINT_DECISION_API_KEY = 'your-key'
```

不要把 key 寫入 repository、plugin 檔案、`.env`、diff 或對話內容。

## 安裝

把此目錄放到 Codex 的 plugin 目錄（`.codex-plugin/plugin.json` 宣告了 `skills/` 與 `.mcp.json`），或在任何支援 MCP stdio 的 client 中以 `node ./scripts/server.mjs` 啟動。

## License

[MIT](LICENSE)
