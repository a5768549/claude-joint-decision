---
name: claude-joint-decision
description: 在 Codex 修改檔案、程式碼、設定、文件或部署內容前後，使用 Claude 作為唯讀的共同決策人與第二審查者；Claude 不得直接修改檔案，Codex 保留最終決策權。
---

# Claude Joint Decision

這個 skill 只在「準備修改內容」或「修改已完成、需要審查 diff」時使用；純問答、摘要、翻譯與不會改變工作樹的查詢不需要呼叫 Claude。

## 強制工作方式

1. **修改前**：對任何非微小的檔案、程式碼、設定、文件、migration、部署或服務操作，先呼叫 `claude_joint_decision`。
2. 把需求、已確認的專案事實、候選方案、限制、預計修改檔案與已知風險傳給 Claude。不要把未確認的猜測寫成事實。
3. 依 Claude 的建議評估方案，但 Codex 仍是主代理；不能把決策權、寫檔權或執行命令權交給 Claude。
4. **修改後**：在完成必要測試、準備交付前，對實際 diff 呼叫 `claude_review_diff`。傳入修改摘要、diff、測試結果與剩餘疑慮。
5. 若 Claude 工具不可用、認證失敗或 API 錯誤，不要假裝已諮詢；繼續處理低風險工作並在回覆中明確標示未完成 Claude 審查。

## 輸入與隱私

- 只提供完成決策所需的最小上下文。
- 不傳送 API key、Bearer token、密碼、cookie、`.env` 內容、私鑰或其他 secret；工具會再做基本遮罩，但不要依賴遮罩取代人工判斷。
- 對大型 diff 先摘要，再截取真正需要審查的區段；不要把整個 repository 無限制上傳。
- Claude 只能讀取你傳給工具的文字，不應被授權修改檔案、執行 shell、部署或呼叫其他工具。

## 建議傳入格式

修改前：

- `request`: 使用者原始需求
- `context`: 已確認的架構、資料流、相關檔案與測試方式
- `constraints`: 不可改動範圍、相容性、部署與安全限制
- `candidate_plan`: Codex 預計採用的最小修改方案

修改後：

- `summary`: 實際完成的修改
- `diff`: 只放相關 diff
- `tests`: 已執行的驗證與結果
- `remaining_concerns`: 尚未解決的疑慮

Claude 回覆後，保留一份簡短的決策紀錄在當前回覆或工作筆記中，包含「採納／不採納」及理由；不要為了形式新增不必要的檔案。
