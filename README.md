# Cordial Conversions API Tag for Google Tag Manager Server Container

The **Cordial Conversions API** tag for GTM Server Side allows you to easily track e-commerce conversions and send order data directly to Cordial's backend.

It is specifically designed to work seamlessly with Cordial's dynamic item schema and features built-in attribution caching. By firing this tag on page views, it will automatically capture Cordial click identifiers from the URL and securely store them in first-party cookies to attribute future server-side orders accurately.

### Useful Links

- [Cordial Orders API Reference](https://support.cordial.com/hc/en-us/articles/204570677-Orders-API#postOrders)
- [Cordial Contacts API Reference](https://support.cordial.com/hc/en-us/articles/203885958-Contacts-API#postContacts)

---

## Configuration

### Event Type

- **Page View:** Extracts Cordial attribution identifiers (`mcID` and `linkID`) from the page URL and stores them in secure 24-hour cookies. No API request is sent.

- **Order:** Builds the order payload using event data, retrieves any cached attribution IDs from cookies, and sends a `POST` request to the Cordial Orders API.

- **Create Contact:** Builds a contact payload from the Contact Fields table and sends a `POST` request to the Cordial Contacts API.

- **Update Contact:** Builds a contact payload from the Contact Fields table and sends a `PUT` request to the Cordial Contacts API, addressing the contact by its primary identifier or a secondary identifier.

---

## Open Source

Cordial Conversions API tag for GTM Server Side is developed and maintained by [Stape Team](https://stape.io/) under the Apache 2.0 license.
