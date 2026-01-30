# Marketplace APIs for AI Shopping Assistant

## Key Finding

No major retailer offers a public API for consumers to place orders programmatically. However, a new ecosystem of "agentic commerce" protocols is emerging fast (OpenAI/Stripe ACP, Google AP2/UCP, Klarna APP).

## Marketplace API Capabilities

| Marketplace | Browse/Search API | Purchase API | Access Model |
|-------------|------------------|--------------|--------------|
| Amazon | PA-API 5.0 (affiliate req.) | None (Alexa only) | Affiliate program |
| eBay | Browse API (limited release) | Order API (limited release) | Partner application |
| Walmart | Affiliate API (public) | None | Affiliate / seller only |
| Target | None public | None (UCP/ACP coming) | Via agentic protocols |
| Best Buy | Products API (public, free) | Commerce API (invite only) | Public + invitation |
| Instacart | IDP API (public + partner) | Via ChatGPT/ACP | Developer application |
| Costco | None public | None | B2B/EDI only |

## Emerging Agentic Commerce Protocols

| Protocol | Purchase Capable | Status | Key Partners |
|----------|-----------------|--------|-------------|
| OpenAI ACP + Stripe | Yes | Live (US) | Etsy, Shopify, Target, Instacart, DoorDash |
| Google UCP + AP2 | Yes (spec) | Developer preview | Shopify, Etsy, Wayfair, Target, Walmart |
| Klarna APP | Discovery only | Live | 100M+ products, 12 markets |
| Perplexity Shopping | Yes | Live (US) | 5,000+ merchants via PayPal |

## Recommended Path

### Phase 1 - Product Discovery (now)
- Klarna APP for structured product catalog
- Amazon PA-API 5.0 for Amazon search/pricing
- PriceAPI or Apify for cross-retailer comparison

### Phase 2 - Assisted Purchasing (now)
- Generate affiliate deeplinks for user to click and buy
- Instacart IDP partner API for grocery checkout
- Alexa Shopping Kit for Amazon (if Alexa available)

### Phase 3 - Autonomous Purchasing (early 2026)
- OpenAI ACP for Stripe-powered merchants
- Google UCP/AP2 as it reaches GA
- Skyvern for approved sites

### Security
- Stripe Shared Payment Tokens (scoped, never expose card numbers)
- Google AP2 Mandates (cryptographically signed spending limits)
- Spending caps, merchant allowlists, audit logs
