// Monedas disponibles para cada cuenta: fiat comunes + top criptomonedas.
// Lista curada (no exhaustiva) — ver README para cómo ampliarla.
//
// Las tasas se consultan en vivo (ver app.js refreshRates/convertAmount)
// pivotando siempre por USD: Frankfurter.app da "unidades de X por 1 USD"
// para fiat, CoinGecko da "precio en USD" para cripto.

export const FIAT_CURRENCIES = [
  { code: 'USD', name: 'Dólar estadounidense' },
  { code: 'MXN', name: 'Peso mexicano' },
  { code: 'EUR', name: 'Euro' },
  { code: 'GBP', name: 'Libra esterlina' },
  { code: 'JPY', name: 'Yen japonés' },
  { code: 'CAD', name: 'Dólar canadiense' },
  { code: 'AUD', name: 'Dólar australiano' },
  { code: 'CHF', name: 'Franco suizo' },
  { code: 'CNY', name: 'Yuan chino' },
  { code: 'INR', name: 'Rupia india' },
  { code: 'BRL', name: 'Real brasileño' },
  { code: 'ARS', name: 'Peso argentino' },
  { code: 'COP', name: 'Peso colombiano' },
  { code: 'CLP', name: 'Peso chileno' },
  { code: 'PEN', name: 'Sol peruano' },
  { code: 'UYU', name: 'Peso uruguayo' },
  { code: 'KRW', name: 'Won surcoreano' },
  { code: 'SEK', name: 'Corona sueca' },
  { code: 'NOK', name: 'Corona noruega' },
  { code: 'DKK', name: 'Corona danesa' },
  { code: 'PLN', name: 'Zloty polaco' },
  { code: 'TRY', name: 'Lira turca' },
  { code: 'ZAR', name: 'Rand sudafricano' },
  { code: 'AED', name: 'Dirham de EAU' },
  { code: 'SAR', name: 'Riyal saudí', },
  { code: 'THB', name: 'Baht tailandés' },
  { code: 'SGD', name: 'Dólar de Singapur' },
  { code: 'HKD', name: 'Dólar de Hong Kong' },
  { code: 'NZD', name: 'Dólar neozelandés' },
  { code: 'ILS', name: 'Séquel israelí' },
  { code: 'PHP', name: 'Peso filipino' },
  { code: 'IDR', name: 'Rupia indonesia' },
  { code: 'MYR', name: 'Ringgit malayo' },
  { code: 'CZK', name: 'Corona checa' },
  { code: 'HUF', name: 'Florín húngaro' },
  { code: 'RON', name: 'Leu rumano' },
];

// code -> id de CoinGecko (para pedir el precio en refreshRates).
export const CRYPTO_CURRENCIES = [
  { code: 'BTC', name: 'Bitcoin', id: 'bitcoin' },
  { code: 'ETH', name: 'Ethereum', id: 'ethereum' },
  { code: 'USDT', name: 'Tether', id: 'tether' },
  { code: 'BNB', name: 'BNB', id: 'binancecoin' },
  { code: 'SOL', name: 'Solana', id: 'solana' },
  { code: 'USDC', name: 'USD Coin', id: 'usd-coin' },
  { code: 'XRP', name: 'XRP', id: 'ripple' },
  { code: 'ADA', name: 'Cardano', id: 'cardano' },
  { code: 'DOGE', name: 'Dogecoin', id: 'dogecoin' },
  { code: 'TON', name: 'Toncoin', id: 'the-open-network' },
  { code: 'TRX', name: 'TRON', id: 'tron' },
  { code: 'AVAX', name: 'Avalanche', id: 'avalanche-2' },
  { code: 'DOT', name: 'Polkadot', id: 'polkadot' },
  { code: 'MATIC', name: 'Polygon', id: 'matic-network' },
  { code: 'LINK', name: 'Chainlink', id: 'chainlink' },
  { code: 'SHIB', name: 'Shiba Inu', id: 'shiba-inu' },
  { code: 'LTC', name: 'Litecoin', id: 'litecoin' },
  { code: 'BCH', name: 'Bitcoin Cash', id: 'bitcoin-cash' },
  { code: 'XLM', name: 'Stellar', id: 'stellar' },
  { code: 'ATOM', name: 'Cosmos', id: 'cosmos' },
];

export const DEFAULT_CURRENCY = 'MXN';

export function currencyInfo(code) {
  return FIAT_CURRENCIES.find((c) => c.code === code) || CRYPTO_CURRENCIES.find((c) => c.code === code) || null;
}

export function currencyLabel(code) {
  const info = currencyInfo(code);
  return info ? `${info.code} — ${info.name}` : code;
}

export function isCrypto(code) {
  return CRYPTO_CURRENCIES.some((c) => c.code === code);
}

export function coingeckoId(code) {
  return CRYPTO_CURRENCIES.find((c) => c.code === code)?.id || null;
}
