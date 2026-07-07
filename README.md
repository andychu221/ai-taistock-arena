# 📈 AI 選股擂台｜Claude × ChatGPT × Gemini

> 🤖 **專案線上體驗**：[點此進入 AI 選股擂台](https://andychu221.github.io/ai-taistock-arena/)

本專案是一個全自動化的台股虛擬投資競賽平台。由三個主流 AI（Claude、ChatGPT、Gemini）各自管理新台幣 100 萬元的虛擬本金，並於每週維持 5 檔台股持股。

本系統採用**純靜態網頁架構（GitHub Pages）**，完全不需自行架設後端伺服器：

* **自動化股價更新**：透過 GitHub Actions 定時排程，每日收盤後自動抓取證交所最新數據。
* **無伺服器後台**：內建管理後台（`admin.html`），可直接在瀏覽器端將交易紀錄與覆盤週報加密寫回 GitHub 儲存庫。

---

## 🛠️ 快速部署指南

### 1. 部署至 GitHub Pages

1. 將本專案的所有檔案與資料夾（包含 `.github/workflows`、`data/`、`assets/`、`scripts/`）完整複製到您的 GitHub 儲存庫（Repository）根目錄下。
2. 進入儲存庫的 **Settings → Pages**。
3. 在 **Build and deployment → Source** 選擇 `Deploy from a branch`。
4. 將 **Branch** 設為 `main`（或您的主要分支），資料夾選擇 `/ (root)`，並按下 **Save**。
5. 稍等 1-2 分鐘部署完成後，即可透過 GitHub 提供給您的專屬網址開啟網站。

### 2. 建立管理後台密鑰（GitHub Personal Access Token）

為了讓管理後台（`admin.html`）擁有將資料寫回 GitHub 的權限，請生成一組 Token：

1. 前往 GitHub **Settings → Developer settings → Personal access tokens → Fine-grained tokens**，點擊 `Generate new token`。
2. 在 **Repository access** 勾選 `Only select repositories`，並指定本專案的儲存庫。
3. 在 **Permissions** 列表中找到 `Contents`，將權限設為 **`Read and write`**（其他皆不用開啟）。
4. 點擊生成並**複製 Token**（此 Token 只會顯示一次，請妥善保存）。

⚠️ **安全性叮嚀**：此 Token 僅會安全地儲存在您個人瀏覽器的 `localStorage` 中，絕不會上傳至任何第三方伺服器。請勿在公用電腦上登入後台，亦不要公開分享您的 `admin.html` 網址。

---

## 📅 每週維運操作流程

### 🔄 步驟一：換股調整（每週一執行）

1. 開啟後台：`您的網站網址/admin.html`。
2. **首次使用設定**：在「GitHub 連線設定」區塊填入您的 GitHub 帳號、儲存庫名稱、分支（如 `main`）並貼上 Token，點擊「儲存設定」。
3. **執行換股表單**：
* **先賣後買**：請先為**要淘汰的舊股票**逐一填寫「賣出」紀錄（成交價與股數）。
* **新增持股**：再為**新選入的股票**逐一填寫「買進」紀錄。
* *註：表單每次送出一筆交易，一週換股通常需要送出 5-10 次。表單下方會即時顯示「目前持股」供您比對核對。*


4. 送出後畫面提示「已寫入 GitHub」，約 1 分鐘內 GitHub Pages 重新部署完成後，首頁數據便會同步更新。

### 📝 步驟二：發布 AI 週報與覆盤分析

1. 切換至後台的「貼上週報 / 覆盤分析」表單。
2. 選擇對應的 AI 角色，填入週次、日期與標題。
3. 將該週與 AI 對話的選股邏輯、核心重點或績效檢討貼入「內容」欄位（支援純文字，系統會自動保留換行符號）。
4. 送出後，內容將立即呈現於網站首頁的「週報與覆盤」分頁中。

---

## 🤖 核心自動化機制

* **自動股價排程**：專案內的 `.github/workflows/update-prices.yml` 腳本會在**每週一至週五的台北時間下午 3:00** 自動觸發。
* **資料來源**：自動呼叫台灣證券交易所（TWSE）的公開資料 API（`STOCK_DAY_ALL`），抓取全市場收盤價。
* **精簡儲存**：腳本非常輕量，只會過濾並保留 `transactions.json` 中有紀錄的股票收盤價，並自動 commit 寫回 `data/prices.json`。
* **手動觸發**：若想立即更新，可隨時至 GitHub 儲存庫的 **Actions** 頁面，選擇 `Update TWSE Closing Prices` 並點擊 `Run workflow` 手動執行。

---

## 📂 資料夾與檔案架構說明（`data/`）

本網站**不儲存寫死的每日績效數據**。每當使用者開啟網頁時，前端會利用 `transactions.json` 的交易軌跡與 `prices.json` 的歷史收盤價，**即時動態重播計算**出每一天每個 AI 的現金流、持股市值與累積報酬率，確保數據絕對精準不衝突。

| 檔案名稱 | 檔案主要用途 |
| --- | --- |
| **`config.json`** | 基礎設定：包含三個 AI 的名稱、專屬代表色、起始資金及賽事開始日期。 |
| **`transactions.json`** | 交易歷史：採用 Append-only 模式，記錄所有買進與賣出的虛擬歷史紀錄。 |
| **`prices.json`** | 股價資料庫：儲存追蹤股票的歷史收盤價（格式如：`{"2330": {"2026-07-06": 950}}`）。 |
| **`journal.json`** | 覆盤日誌：保存每週發布的 AI 選股邏輯與每週覆盤文字紀錄。 |

---

## 🚀 未來擴充方向建議

* **新增第 4 個 AI 參賽者**：只需在 `data/config.json` 的 `ais` 陣列中新增一個物件，前台與管理後台便會全面自動支援新角色。
* **引進盤中即時報價**：可將 `scripts/update_prices.py` 替換為證交所的即時行情 API，並縮短 GitHub Actions 的排程執行間隔（需注意 API 呼叫頻率限制）。
* **支援已實現損益統計**：目前預設僅呈現未實現損益。可在 `transactions.json` 與後台表單中擴充欄位，用以精準錨定與加總已落袋的實現損益數據。
