import yfinance as yf
import pandas as pd
import numpy as np
from datetime import datetime

def run_soxl_loan_backtest():
    ticker_name = 'SOXL'
    interest_rate = 0.0465 # 4.65%
    
    print(f"[Data] SOXL 데이터 다운로드 중...")
    raw = yf.download(ticker_name, start='2010-01-01', auto_adjust=True, progress=False)
    
    if isinstance(raw.columns, pd.MultiIndex):
        df = pd.DataFrame({
            'Close': raw['Close'][ticker_name],
            'High': raw['High'][ticker_name],
            'Low': raw['Low'][ticker_name]
        })
    else:
        df = pd.DataFrame({
            'Close': raw['Close'],
            'High': raw['High'],
            'Low': raw['Low']
        })
    
    df['SMA200'] = df['Close'].rolling(window=200).mean()
    df = df.dropna(subset=['SMA200']).copy()

    # Day 3 Confirmation
    df['Above'] = df['Close'] > df['SMA200']
    df['Streak'] = df['Above'].groupby((df['Above'] != df['Above'].shift()).cumsum()).cumsum()
    df['Streak'] = np.where(df['Above'], df['Streak'], 0)
    
    # 6-Step Strategy Parameters
    # (Threshold, Sell_Pct_of_Current)
    tp_rules = [
        (10, 0.10),
        (45, 0.10),
        (100, 0.50),
        (140, 0.30),
        (210, 0.50),
        (250, 1.00)
    ]

    cash = 100000000 # 1억원 시작 (가정)
    shares = 0
    in_pos = False
    entry_price = 0
    tp_reached = [False] * len(tp_rules)
    
    total_interest = 0
    history = []
    
    for i in range(len(df)):
        date = df.index[i]
        price = df.iloc[i]['Close']
        high = df.iloc[i]['High']
        sma = df.iloc[i]['SMA200']
        
        # 1. Daily Interest Calculation (on loan amount, which we assume is the full current position value)
        if in_pos:
            daily_interest = (shares * price) * (interest_rate / 365)
            total_interest += daily_interest
            # Technically interest is paid from cash or added to loan
            # Here we just track it to subtract from final equity

        # 2. Check Exit
        if in_pos and price < sma:
            cash += shares * price
            shares = 0
            in_pos = False
            history.append({'date': date, 'event': 'EXIT', 'price': price, 'equity': cash})

        # 3. Check Entry
        if not in_pos and df.iloc[i]['Streak'] == 3:
            in_pos = True
            entry_price = price
            shares = cash / price
            cash = 0
            tp_reached = [False] * len(tp_rules)
            history.append({'date': date, 'event': 'ENTRY', 'price': price, 'equity': shares * price})

        # 4. Check Take Profits (using High of the day)
        if in_pos:
            current_return = (high - entry_price) / entry_price * 100
            for idx, (threshold, sell_pct) in enumerate(tp_rules):
                if not tp_reached[idx] and current_return >= threshold:
                    # Sell at threshold price or high? Let's be conservative and use threshold price or open
                    # For simplicity, use the threshold price
                    sell_price = entry_price * (1 + threshold/100)
                    sell_shares = shares * sell_pct
                    cash += sell_shares * sell_price
                    shares -= sell_shares
                    tp_reached[idx] = True
                    history.append({'date': date, 'event': f'TP_{threshold}%', 'price': sell_price, 'equity': cash + shares * price})
        
        # Log daily equity for CAGR calculation
        curr_equity = cash + shares * price
        df.at[date, 'Equity'] = curr_equity

    final_equity = df['Equity'].iloc[-1] - total_interest
    years = (df.index[-1] - df.index[0]).days / 365.25
    cagr = ((final_equity / 100000000) ** (1/years) - 1) * 100
    
    # Calculate Buy & Hold SOXL for comparison
    bh_final = (df['Close'].iloc[-1] / df['Close'].iloc[0]) * 100000000
    bh_cagr = ((bh_final / 100000000) ** (1/years) - 1) * 100

    print(f"\n[결과 보고서] SOXL 6단계 촘촘한 익절 전략")
    print(f"기간: {df.index[0].date()} ~ {df.index[-1].date()} ({years:.1f}년)")
    print("-" * 50)
    print(f"최종 자산: {final_equity:,.0f}원 (초기 1억원 기준)")
    print(f"누적 수익률: {(final_equity/100000000 - 1)*100:,.2f}%")
    print(f"CAGR: {cagr:.2f}%")
    print(f"총 지불 이자: {total_interest:,.0f}원")
    print("-" * 50)
    print(f"SOXL 단순 보유(B&H) CAGR: {bh_cagr:.2f}%")
    
    # MDD Calculation
    peak = df['Equity'].cummax()
    drawdown = (df['Equity'] - peak) / peak * 100
    mdd = drawdown.min()
    print(f"전략 MDD: {mdd:.2f}%")

if __name__ == "__main__":
    run_soxl_loan_backtest()
