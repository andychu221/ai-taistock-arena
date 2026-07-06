"""
使用 yfinance 抓取股票資料，包含開、高、低、收、量 (OHLCV)。
會自動追蹤交易紀錄中的股票以及 config.json 中設定的 benchmark。
若為新股票，會抓取過去一年的歷史資料；否則只補足最新的資料。
"""
import json
import sys
from datetime import datetime, timezone, timedelta
import yfinance as yf

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

def main():
    transactions = load_json("data/transactions.json", [])
    config = load_json("data/config.json", {})
    prices = load_json("data/prices.json", {})
    
    tickers = {t["ticker"] for t in transactions if t.get("ticker")}
    benchmark = config.get("benchmark", "0050")
    if benchmark:
        tickers.add(benchmark)
        
    if not tickers:
        print("沒有需要更新的股票。")
        return

    updated = []
    
    for ticker in sorted(tickers):
        # 嘗試加上 .TW (上市) 或 .TWO (上櫃)
        symbol = f"{ticker}.TW"
        stock = yf.Ticker(symbol)
        df = stock.history(period="1y")
        
        if df.empty:
            symbol = f"{ticker}.TWO"
            stock = yf.Ticker(symbol)
            df = stock.history(period="1y")
            
        if df.empty:
            print(f"找不到代號資料: {ticker}")
            continue
            
        if ticker not in prices:
            prices[ticker] = {}
            
        for date, row in df.iterrows():
            date_str = date.strftime("%Y-%m-%d")
            # 若已經有資料且並非今日，則不覆寫（保留持續疊加特性）
            prices[ticker][date_str] = {
                "open": round(row['Open'], 2),
                "high": round(row['High'], 2),
                "low": round(row['Low'], 2),
                "close": round(row['Close'], 2),
                "volume": int(row['Volume'])
            }
        updated.append(ticker)

    save_json("data/prices.json", prices)
    print(f"已成功更新 OHLCV 歷史資料：{updated}")

if __name__ == "__main__":
    main()
