# ChartGold

A browser-based charting and backtesting workspace built with React, TypeScript, Vite, and Lightweight Charts.

## Live crypto market data

ChartGold can load live OHLCV candles for supported Nobitex markets through the public UDF history API:

- BTCIRT, ETHIRT, USDTIRT
- LTCIRT, XRPIRT, DOGEIRT, TRXIRT, ADAIRT, BNBIRT, SOLIRT
- BTCUSDT, ETHUSDT

Select one of these symbols from **Symbol Search**. The chart fetches up to 500 candles and refreshes approximately once per minute. A same-origin `/api/nobitex-history` endpoint proxies requests to Nobitex, avoiding browser CORS restrictions and sending the recommended `TraderBot/ChartGold-1.0.0` User-Agent.

The source API supports a fixed set of candle resolutions. ChartGold uses native resolutions where possible and aggregates candles for 3-minute, 2-hour, and weekly views.

**Important:** Nobitex is a crypto exchange. Its API cannot provide live XAUUSD gold, forex pairs, oil, or stock-index prices. Those existing symbols remain sample data unless a separate market-data provider or CSV history is connected.

## Development

```bash
npm install
npm run dev
```

Build the application:

```bash
npm run build
```
