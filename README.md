# AI 選股擂台｜Claude × ChatGPT × Gemini

三個 AI（Claude、ChatGPT、Gemini）各自管理新台幣 100 萬本金，每週維持 5 檔台股持股。
這個網站會自動記錄每個 AI 的進出場、每日股價與累積績效，並提供一個管理後台可以直接把交易紀錄與週報貼上、寫回這個 GitHub repo。

網站是純靜態網頁（GitHub Pages），股價更新靠 GitHub Actions 排程，不需要自己架伺服器。

---

## 1. 部署到 GitHub Pages

1. 把這個資料夾裡的所有檔案，放到你現有的 GitHub repo 裡（保留原本的資料夾結構，`.github/workflows`、`data/`、`assets/`、`scripts/` 都要在 repo 根目錄）。
2. 到 repo 的 **Settings → Pages**。
3. **Source** 選 `Deploy from a branch`，Branch 選 `main`，資料夾選 `/ (root)`，按 Save。
4. 等 1-2 分鐘，Pages 會給你一個網址，格式通常是：
   `https://你的帳號.github.io/repo名稱/`
5. 打開這個網址，應該會看到「AI 選股擂台」的畫面（一開始因為還沒有資料，會顯示空狀態，這是正常的）。

---

## 2. 建立 GitHub Personal Access Token（給管理後台用）

管理後台（`admin.html`）需要一組 Token 才能把你貼的資料寫回 repo。

1. 到 GitHub **Settings → Developer settings → Personal access tokens → Fine-grained tokens** → `Generate new token`。
2. **Repository access** 選 `Only select repositories`，選這個 repo。
3. **Permissions** 裡的 `Contents` 設成 `Read and write`，其他都不用開。
4. 建議設定一個到期日（例如 90 天），到期後再重新產生一組。
5. 產生後複製 Token（只會顯示一次，請先存好）。

> ⚠️ **安全提醒**：這個 Token 只會存在你瀏覽器的 localStorage，不會被上傳。但只要有人打開你的瀏覽器或知道你貼過 Token 的畫面，就有可能拿到它。
> - 不要把 `admin.html` 的連結公開分享。
> - 不要在公用電腦上登入管理後台。
> - Token 外洩時，直接到 GitHub 設定頁刪除它即可，不影響其他資料。

---

## 3. 每週操作流程

### 換股（週一調整持股）
1. 打開 `你的網址/admin.html`，第一次使用先在「GitHub 連線設定」填入帳號、repo 名稱、分支（通常是 `main`）、貼上 Token，按「儲存設定」。
2. 到「新增進出場紀錄」：
   - 先為**要賣出**的舊股票，各新增一筆「賣出」紀錄（股數、成交價）。
   - 再為**新選入**的股票，各新增一筆「買進」紀錄。
   - 一次只能新增一筆，一週 5 檔換股大概要送出 5～10 次表單（賣舊 + 買新）。
   - 「目前持股」會顯示在表單下方，方便你確認要賣哪些。
3. 每筆送出後，畫面會顯示「已寫入 GitHub」，回到首頁重新整理就能看到更新（可能要等 Pages 重新部署，約 1 分鐘內）。

### 每週週報 / 覆盤
1. 到「貼上週報 / 覆盤分析」表單。
2. 選擇 AI、填入週次、日期、標題。
3. 把這週跟 AI 的對話重點、選股邏輯、績效檢討直接貼進「內容」欄位（純文字即可，會保留換行）。
4. 送出後會出現在首頁「週報與覆盤」分頁。

---

## 4. 股價怎麼自動更新

- `.github/workflows/update-prices.yml` 這個排程，會在**每個週一到週五、台北時間下午 3 點**自動執行 `scripts/update_prices.py`。
- 這個腳本會呼叫證交所公開資料 API（`STOCK_DAY_ALL`），抓當天所有上市股票的收盤價，只保留你 `transactions.json` 裡出現過的股票代號，寫回 `data/prices.json` 並自動 commit。
- 如果想立刻測試，不用等排程：到 repo 的 **Actions** 分頁 → 選 `Update TWSE Closing Prices` → 按 `Run workflow`。
- 目前抓的是**收盤價**（不是即時盤中價），且沒有另外處理國定假日／颱風假，遇到非交易日腳本會自動找不到資料並略過，不會報錯中斷。

---

## 5. 資料檔案說明（`data/` 資料夾）

| 檔案 | 用途 |
|---|---|
| `config.json` | 三個 AI 的名稱、代表色、起始資金、開始日期 |
| `transactions.json` | 所有買進/賣出紀錄（append-only，網站靠這個回推每天的持股與現金） |
| `prices.json` | 每檔股票、每個日期的收盤價，格式 `{ "2330": { "2026-07-06": 950 } }` |
| `journal.json` | 每週的週報／覆盤文字紀錄 |

網站首頁不會另外存「每日績效」這個檔案，而是每次打開網頁時，用 `transactions.json + prices.json` 即時重播計算出每一天三個 AI 的現金、持股市值與累積報酬率，所以不用擔心績效資料跟交易紀錄對不起來。

---

## 6. 之後可以怎麼擴充

- 想比較「已實現/未實現損益」：目前只顯示未實現損益，如果要記錄實現損益，可以在賣出紀錄旁加一個欄位。
- 想要盤中價：把 `scripts/update_prices.py` 換成呼叫證交所即時報價端點，並縮短排程間隔（要留意證交所 API 的使用限制）。
- 想要多加第 4 個 AI：在 `config.json` 的 `ais` 陣列加一筆，管理後台跟首頁會自動抓到新的 AI 選項。
