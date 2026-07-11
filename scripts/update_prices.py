import json
import sys
import math
from datetime import datetime, timezone, timedelta
import yfinance as yf

def load_json(path, default):
    try:
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    except FileNotFoundError:
        return default
    except json.JSONDecodeError as e:
        print(f"警告：{path} 格式錯誤，自動重置。錯誤訊息: {e}")
        return default

def save_json(path, data):
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
        f.write("\n")

def main():
    transactions = load_json("data/transactions.json", [])
    config = load_json("data/config.json", {})
    prices = load_json("data/prices.json", {})

    tickers = {t["ticker"] for t in transactions if isinstance(t, dict) and t.get("ticker")}

    # Benchmark 前台固定寫死 4 檔（2330 / 0050 / 00631L / 00981A），每次更新都一併抓取，
    # 這樣前台的 Benchmark 切換按鈕才會一直有資料可用。
    fixed_benchmarks = ["2330", "0050", "00631L", "00981A"]
    tickers.update(fixed_benchmarks)

    # 相容舊版設定：如果 config.json 裡還有寫 benchmark_ticker，也一併納入
    legacy_benchmark = config.get("benchmark_ticker") or config.get("benchmark")
    if legacy_benchmark:
        tickers.add(legacy_benchmark)
        
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
            
        if ticker not in prices or not isinstance(prices[ticker], dict):
            prices[ticker] = {}
            
        for date, row in df.iterrows():
            date_str = date.strftime("%Y-%m-%d")
            # 若已經有資料且並非今日，則不覆寫（保留持續疊加特性）
            # 過濾掉 NaN (沒開盤或壞資料)
            if math.isnan(row['Close']):
                continue
                
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
