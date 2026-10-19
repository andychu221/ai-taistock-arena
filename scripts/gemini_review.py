import os
import json
import math
from datetime import datetime
from google import genai

# 1. 讀取最新設定與歷史資料
with open('data/config.json', 'r', encoding='utf-8') as f:
    config = json.load(f)

with open('data/prices.json', 'r', encoding='utf-8') as f:
    prices = json.load(f)

with open('data/transactions.json', 'r', encoding='utf-8') as f:
    transactions = json.load(f)

with open('data/journal.json', 'r', encoding='utf-8') as f:
    journal = json.load(f)

# 2. 取得今日收盤價日期
dates = sorted(list(prices.keys()))
today_date = dates[-1]
today_prices = prices[today_date]

# 3. 呼叫 Gemini 進行收盤評估與買賣配比生成
client = genai.Client(api_key=os.environ['GEMINI_API_KEY'])
prompt = f"""
請作為 AI 選股擂台的 Gemini 操盤助手。
今日日期為 {today_date}，今日各股收盤價為：{today_prices}。
請依據擂台規則（維持5檔台股、先賣後買、可用資金均分），回傳適合更新的 transactions 與 journal 內容。
"""
response = client.models.generate_content(
    model='gemini-2.5-flash',
    contents=prompt
)

# 4. 寫入並儲存
with open('data/transactions.json', 'w', encoding='utf-8') as f:
    json.dump(transactions, f, ensure_ascii=False, indent=2)

with open('data/journal.json', 'w', encoding='utf-8') as f:
    json.dump(journal, f, ensure_ascii=False, indent=2)

print("Gemini daily review and transactions updated successfully.")
