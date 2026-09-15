# Cordial Tag for Google Tag Manager Server Container

The **Cordial** tag for GTM Server Side sends Order, Create Contact and Update Contact events directly to [Cordial's](https://www.cordial.com/) REST API, and can capture URL-based attribution identifiers on page views.

### Useful Links

- [Orders API](https://support.cordial.com/hc/en-us/articles/204570677-Orders-API)
- [Contacts API](https://support.cordial.com/hc/en-us/articles/203885958-Contacts-API)
- [API keys](https://support.cordial.com/hc/en-us/articles/115005365087-API-keys)

---

## Important: API key IP allowlist

Cordial requires you to **allowlist the calling IP address(es)** when you create an API key — see [API keys](https://support.cordial.com/hc/en-us/articles/115005365087-API-keys). Requests from an IP that isn't allowlisted are rejected.

This is a problem if your server-side GTM container runs on a **dynamic IP**, since the outbound IP can change and fall out of the allowlist.

- If you use [Stape](https://stape.io/) to host your sGTM, add the [dedicated outbound IP](https://stape.io/helpdesk/documentation/dedicated-ip-power-up) power-up so the outbound IP stays static, then allowlist that IP in Cordial.
- Otherwise, ask whoever manages your server-side GTM hosting for its static outbound IP(s).
- As a last resort, Cordial's allowlist accepts CIDR ranges, so `0.0.0.0/0` allows any IP — this removes the protection the allowlist provides, so only use it if you understand the tradeoff.

---

## Configuration

### Event Type

- **Page View:** Extracts the `mcID` and `linkID` attribution identifiers from the page URL and stores them in secure cookies (90 days by default) for later Order events. No API request is sent. `msID` is **not** auto-captured this way — see below for why that's fine.

### Automap from Event Data

Enabled by default (**Automap from Event Data** checkbox). When on, these fields fall back to Event Data if left empty:

| Field | Falls back to |
| :--- | :--- |
| Order ID | `eventData.transaction_id` |
| User email (Order) | `eventData.email`, then `eventData.user_data.email`, then `eventData.user_data.email_address` |
| Client ID (Order Properties) | `eventData.user_id` |
| Total Amount (Order Properties) | `eventData.value` |
| Shipping and Handling Cost (Order Properties) | `eventData.shipping` |
| Items (Order Properties) | `eventData.items` |
| Email Address (Create Contact) | `eventData.email`, then `eventData.user_data.email`, then `eventData.user_data.email_address` |

Disable it to require every one of these values to be set explicitly. Note that `Client ID` only falls back to `eventData.user_id` — never to `eventData.client_id` (the GA4/Measurement Protocol client ID), since that browser-generated identifier isn't guaranteed to match a Cordial contact.

### Cookie Settings

Only **Page View** writes the attribution cookies, so **Cookie Settings** (Cookie Expiration, Cookie Domain, Http Only Flag) is only shown for that event type. By default the cookies expire after 90 days, use the auto-detected top-level domain, and aren't `HttpOnly`.

- **Order:** Builds the order payload from event data and the tag's fields, resolving `mcID`/`linkID` from the current URL first, then from the cached cookie — it never writes the cookie itself — and sends a `POST` request to the Cordial Orders API. Requires either a **User email** or **Cordial User ID**.

- **Create Contact:** Builds a contact payload from the Contact Fields table and sends a `POST` request to the Cordial Contacts API.

- **Update Contact:** Builds a contact payload from the Contact Fields table and sends a `PUT` request to the Cordial Contacts API, addressing the contact by its Primary Identifier or a secondary key.

### Order Properties

The **Order Properties** table maps extra Orders API fields that aren't covered by the dedicated fields above:

| Property | Maps to |
| :--- | :--- |
| Client ID | `customerID` |
| Link ID | overrides the `linkID` resolved from the URL/cookie |
| Cordial ID (Account, Contact and Message) | overrides the `mcID` resolved from the URL/cookie |
| Message ID | `msID` |
| Items | overrides the auto-mapped Event Data `items` array |
| Total Amount | `totalAmount` |
| Tax | `tax` |
| Shipping and Handling Cost | `shippingAndHandling` |
| Discount Amount (Fixed) | `discountApplication: { type: "fixed", amount }` — Cordial only supports fixed-amount discounts |
| Store ID | `storeID` |
| Order Status | `status` |
| Suppress Triggers | `suppressTriggers` |
| Shipping/Billing Address: Name, Street, City, State, Postal Code, Country | merged into the `shippingAddress` / `billingAddress` object (only the sub-fields you set are included) |

`msID` is not captured automatically. Cordial documents `mcID` as already encoding the message identity (`mcID` = `msID` + `cID` + a timestamp), so Cordial can attribute an order to the right message from `mcID` alone — this tag only auto-captures `mcID`/`linkID`. Set `Message ID` here only if you need the standalone `msID` field populated on the order itself (e.g. for Cordial's `GET /orders?msID=...` lookups); parsing it back out of `mcID` isn't done automatically since Cordial's own docs show inconsistent examples of that string's exact format.

`Store ID`, `Order Status`, `Suppress Triggers` and the extra item fields recognized by this tag (`salePrice`, `productType`, `manufacturerName`, `UPCCode`, `inStock`, `taxable`, `enabled` in Event Data items) come from Cordial's live OpenAPI schema rather than the public help-center articles — see `docs/` in this repo for the extracted reference.

The **Custom Properties** table maps additional key/value pairs into the order's `properties` object.

### Contact Fields

The **Contact Fields** table (Create/Update Contact) accepts any Cordial contact attribute, plus these special keys:

- `subscribeStatus`, `invalid` and `address` are automatically nested under the email channel (`channels.email.subscribeStatus` / `channels.email.invalid` / `channels.email.address`) as required by the Contacts API. Use `address` on Update Contact to change the contact's email address.
- `forceSubscribe` and `suppressTriggers` are sent as top-level fields.
- `identifyBy` (Create Contact only — ignored on Update Contact) takes a comma-separated list of secondary keys in priority order, e.g. `email,custID`.

Custom attributes must already exist in Cordial (with the matching type — string, number, geo, etc) before they can be set here, otherwise they may be dropped. See the [Contacts API documentation](https://support.cordial.com/hc/en-us/articles/203885958-Contacts-API) for the full field reference.

---

## Open Source

Cordial tag for GTM Server Side is developed and maintained by [Stape Team](https://stape.io/) under the Apache 2.0 license.