"""
每個交易日執行一次：
1. 從 data/transactions.json 找出所有曾經交易過的股票代號
2. 呼叫證交所開放資料 API，抓當天所有上市股票的收盤價
3. 把追蹤股票的收盤價寫回 data/prices.json

證交所開放資料 API 文件：https://openapi.twse.com.tw/
使用的端點：STOCK_DAY_ALL（每日收盤行情，全部上市股票）
"""

import json
import sys
from datetime import datetime, timedelta, timezone

import requests

TWSE_URL = "https://openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_ALL"
TAIPEI = timezone(timedelta(hours=8))


def load_json(path, default):
    try:
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    except FileNotFoundError:
        return default


def save_json(path, data):
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
        f.write("\n")


def get_tracked_tickers(transactions):
    return sorted({t["ticker"] for t in transactions if t.get("ticker")})


def main():
    today = datetime.now(TAIPEI).strftime("%Y-%m-%d")

    transactions = load_json("data/transactions.json", [])
    tickers = get_tracked_tickers(transactions)

    if not tickers:
        print("目前 transactions.json 沒有任何股票代號，略過本次更新。")
        return

    resp = requests.get(TWSE_URL, timeout=30)
    resp.raise_for_status()
    rows = resp.json()

    # 建立 代號 -> 收盤價 的對照表
    close_by_code = {}
    for row in rows:
        code = row.get("Code")
        close = row.get("ClosingPrice")
        if code and close not in (None, "", "--"):
            try:
                close_by_code[code] = float(str(close).replace(",", ""))
            except ValueError:
                continue

    prices = load_json("data/prices.json", {})
    updated = []
    missing = []

    for ticker in tickers:
        if ticker in close_by_code:
            prices.setdefault(ticker, {})
            prices[ticker][today] = close_by_code[ticker]
            updated.append(ticker)
        else:
            missing.append(ticker)

    save_json("data/prices.json", prices)

    print(f"日期：{today}")
    print(f"已更新：{updated}")
    if missing:
        print(f"查無資料（可能非交易日、下市或代號錯誤）：{missing}")


if __name__ == "__main__":
    try:
        main()
    except requests.RequestException as e:
        print(f"抓取證交所資料失敗：{e}", file=sys.stderr)
        # 不要讓 workflow 因為單次網路失敗而顯示紅叉太頻繁地嚇人，但仍以非 0 結束
        sys.exit(1)
