const encodeUriComponent = require('encodeUriComponent');
const getAllEventData = require('getAllEventData');
const getCookieValues = require('getCookieValues');
const getRequestHeader = require('getRequestHeader');
const getTimestampMillis = require('getTimestampMillis');
const getType = require('getType');
const JSON = require('JSON');
const logToConsole = require('logToConsole');
const makeInteger = require('makeInteger');
const makeNumber = require('makeNumber');
const makeString = require('makeString');
const makeTableMap = require('makeTableMap');
const Math = require('Math');
const parseUrl = require('parseUrl');
const sendHttpRequest = require('sendHttpRequest');
const setCookie = require('setCookie');

/*==============================================================================
==============================================================================*/

const eventData = getAllEventData();

if (shouldExitEarly(data, eventData)) return;

if (data.eventType === 'pageview') {
  cacheAttributionIds();
  return data.gtmOnSuccess();
} else if (data.eventType === 'order') {
  const failed = trackOrder(eventData);
  if (!failed && data.useOptimisticScenario) {
    return data.gtmOnSuccess();
  }
} else if (data.eventType === 'createContact') {
  const failed = createContact(eventData);
  if (!failed && data.useOptimisticScenario) {
    return data.gtmOnSuccess();
  }
} else if (data.eventType === 'updateContact') {
  const failed = updateContact(eventData);
  if (!failed && data.useOptimisticScenario) {
    return data.gtmOnSuccess();
  }
} else {
  return data.gtmOnSuccess();
}

/*==============================================================================
  Vendor related functions
==============================================================================*/

function getMappedOrderProperty(propertyKey) {
  if (data.orderProperties && data.orderProperties.length) {
    for (let i = 0; i < data.orderProperties.length; i++) {
      if (data.orderProperties[i].key === propertyKey) {
        return data.orderProperties[i].value;
      }
    }
  }
  return undefined;
}

function getAttributionParam(paramName, cookieName, overrideValue) {
  if (isValidValue(overrideValue)) return overrideValue;

  const url = getUrl(eventData);
  const param = getQueryParam(url, paramName);
  if (param) {
    setCookie(cookieName, param, {
      domain: 'auto',
      path: '/',
      secure: true,
      'max-age': 60 * 60 * 24 // 24 hours
    });
    return param;
  }

  const cookieValue = getCookieValues(cookieName)[0];
  if (cookieValue) return cookieValue;

  return undefined;
}

function cacheAttributionIds() {
  getAttributionParam('mcID', 'cordial_mcID');
  getAttributionParam('linkID', 'cordial_linkID');
}

function createContact(eventData) {
  const eventDataUserData = eventData.user_data || {};
  const email =
    data.address || eventData.email || eventDataUserData.email || eventDataUserData.email_address;

  if (!isValidValue(email)) {
    log({
      Name: 'Cordial',
      Type: 'Message',
      Message: '🛑 [ERROR] Contact was not created.',
      Reason: 'Missing required parameter: "address".'
    });
    data.gtmOnFailure();
    return true;
  }

  const contactData = mapContactData();
  contactData.channels = { email: { address: makeString(email) } };

  sendRequest('POST', 'contacts', contactData);
  return false;
}

function updateContact() {
  const identifier = getContactIdentifier();
  if (!identifier) {
    data.gtmOnFailure();
    return true;
  }

  const contactData = mapContactData();

  sendRequest('PUT', 'contacts/' + identifier, contactData);
  return false;
}

function getContactIdentifier() {
  if (data.useSecondaryIdentifier) {
    if (!isValidValue(data.secondaryKeyName) || !isValidValue(data.secondaryKeyValue)) {
      log({
        Name: 'Cordial',
        Type: 'Message',
        Message: '🛑 [ERROR] Contact was not updated.',
        Reason: 'Missing required parameters: "secondaryKeyName" and/or "secondaryKeyValue".'
      });
      return undefined;
    }
    return (
      encodeUriComponent(data.secondaryKeyName) + ':' + encodeUriComponent(data.secondaryKeyValue)
    );
  }

  if (!isValidValue(data.primaryKey)) {
    log({
      Name: 'Cordial',
      Type: 'Message',
      Message: '🛑 [ERROR] Contact was not updated.',
      Reason: 'Missing required parameter: "primaryKey".'
    });
    return undefined;
  }

  const parts = makeString(data.primaryKey).split(':');
  if (parts.length === 2) {
    return encodeUriComponent(parts[0]) + ':' + encodeUriComponent(parts[1]);
  }

  return encodeUriComponent(data.primaryKey);
}

function mapContactData() {
  const contactData = {};
  if (data.createContactParameters && data.createContactParameters.length) {
    const fields = makeTableMap(data.createContactParameters, 'key', 'value');
    for (let key in fields) {
      contactData[key] = coerceContactFieldValue(fields[key]);
    }
  }
  return contactData;
}

function coerceContactFieldValue(value) {
  if (value === 'true' || value === true) return true;
  if (value === 'false' || value === false) return false;
  return value;
}

function trackOrder(eventData) {
  const mappedOrderData = mapOrderData(eventData);

  if (!isValidValue(mappedOrderData.orderID)) {
    log({
      Name: 'Cordial',
      Type: 'Message',
      Message: '🛑 [ERROR] Order was not sent.',
      Reason: 'Missing required parameter: "orderId".'
    });
    data.gtmOnFailure();
    return true;
  }

  if (!isValidValue(mappedOrderData.email) && !isValidValue(mappedOrderData.cID)) {
    log({
      Name: 'Cordial',
      Type: 'Message',
      Message: '🛑 [ERROR] Order was not sent.',
      Reason: 'Missing required identifier: "email" or "cID".'
    });
    data.gtmOnFailure();
    return true;
  }

  sendRequest('POST', 'orders', mappedOrderData);
  return false;
}

function mapOrderData(eventData) {
  const orderId = data.orderId || eventData.transaction_id;
  const mcID = getAttributionParam('mcID', 'cordial_mcID', getMappedOrderProperty('mcId'));
  const linkID = getAttributionParam('linkID', 'cordial_linkID', getMappedOrderProperty('linkId'));
  const msID = getMappedOrderProperty('msId');
  const mappedData = {};

  if (orderId) mappedData.orderID = makeString(orderId);

  if (data.purchaseDate) {
    mappedData.purchaseDate = makeString(data.purchaseDate);
  } else {
    mappedData.purchaseDate = convertTimestampToISO(getTimestampMillis());
  }

  const eventDataUserData = eventData.user_data || {};
  if (isValidValue(data.email)) mappedData.email = data.email;
  else if (eventData.email) mappedData.email = eventData.email;
  else if (eventDataUserData.email) mappedData.email = eventDataUserData.email;
  else if (eventDataUserData.email_address) mappedData.email = eventDataUserData.email_address;

  if (isValidValue(data.cid)) mappedData.cID = data.cid;

  const customerID = getMappedOrderProperty('clientId');
  if (customerID) mappedData.customerID = makeString(customerID);
  else if (eventData.user_id) mappedData.customerID = makeString(eventData.user_id);
  else if (eventData.client_id) mappedData.customerID = makeString(eventData.client_id);

  if (mcID) mappedData.mcID = makeString(mcID);
  if (linkID) mappedData.linkID = makeString(linkID);
  if (msID) mappedData.msID = makeString(msID);

  const totalAmount = getMappedOrderProperty('totalAmount');
  if (totalAmount) mappedData.totalAmount = makeNumber(totalAmount);
  else if (eventData.value) mappedData.totalAmount = makeNumber(eventData.value);

  const tax = getMappedOrderProperty('tax');
  if (tax) mappedData.tax = makeNumber(tax);

  const shippingCost = getMappedOrderProperty('shippingCost');
  if (shippingCost) mappedData.shippingAndHandling = makeNumber(shippingCost);
  else if (eventData.shipping) mappedData.shippingAndHandling = makeNumber(eventData.shipping);

  if (data.orderCustomProperties && data.orderCustomProperties.length) {
    const customProperties = makeTableMap(data.orderCustomProperties, 'key', 'value');
    mappedData.properties = customProperties;
  }

  const items = getMappedOrderProperty('items') || eventData.items;
  if (getType(items) === 'array') mappedData.items = formatItems(items);
  return mappedData;
}

function formatItems(items) {
  if (!items || !items.length) return [];

  return items.map((item) => {
    const formattedItem = {};
    const customProperties = {};

    for (let key in item) {
      if (key === 'productID' || key === 'item_id') {
        formattedItem.productID = makeString(item[key]);
      } else if (key === 'sku') {
        formattedItem.sku = makeString(item[key]);
      } else if (key === 'name' || key === 'item_name') {
        formattedItem.name = makeString(item[key]);
      } else if (key === 'category' || key === 'item_category') {
        formattedItem.category = makeString(item[key]);
      } else if (key === 'qty' || key === 'quantity') {
        formattedItem.qty = makeInteger(item[key]);
      } else if (key === 'itemPrice' || key === 'price') {
        formattedItem.itemPrice = makeNumber(item[key]);
      } else if (key === 'amount') {
        formattedItem.amount = makeNumber(item[key]);
      } else if (key === 'description' || key === 'url' || key === 'images' || key === 'tags') {
        formattedItem[key] = item[key];
      } else {
        customProperties[key] = item[key];
      }
    }

    if (!formattedItem.amount && formattedItem.qty && formattedItem.itemPrice) {
      formattedItem.amount = makeNumber(formattedItem.qty * formattedItem.itemPrice);
    }

    if (!formattedItem.sku && formattedItem.productID) {
      formattedItem.sku = formattedItem.productID;
    }

    let hasCustomProps = false;
    for (let prop in customProperties) {
      hasCustomProps = true;
      break;
    }
    if (hasCustomProps) {
      formattedItem.properties = customProperties;
    }

    return formattedItem;
  });
}

function sendRequest(method, path, body) {
  const url = 'https://api.cordial.io/v2/' + path;

  return sendHttpRequest(
    url,
    (statusCode, headers, responseBody) => {
      let parsedBody = {};
      if (responseBody) parsedBody = JSON.parse(responseBody);

      if (!data.useOptimisticScenario) {
        if (statusCode >= 200 && statusCode < 400 && !parsedBody.errors) {
          data.gtmOnSuccess();
        } else {
          log({
            Name: 'Cordial',
            Type: 'Message',
            Message: '🛑 [ERROR] API call failed.',
            Status: statusCode,
            Response: parsedBody
          });
          data.gtmOnFailure();
        }
      }
    },
    {
      headers: {
        Authorization: 'Basic ' + data.apiKey,
        'Content-Type': 'application/json'
      },
      method: method,
      timeout: 3500
    },
    JSON.stringify(body)
  );
}

/*==============================================================================
  Helpers
==============================================================================*/

function getQueryParam(url, param) {
  if (!url) return undefined;
  const parsed = parseUrl(url);
  if (parsed && parsed.searchParams && parsed.searchParams[param]) {
    return parsed.searchParams[param];
  }
  return undefined;
}

function convertTimestampToISO(timestamp) {
  const leapYear = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  const nonLeapYear = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  const secToMs = (s) => s * 1000;
  const minToMs = (m) => m * secToMs(60);
  const hoursToMs = (h) => h * minToMs(60);
  const daysToMs = (d) => d * hoursToMs(24);
  const padStart = (value, length) => {
    let result = makeString(value);
    while (result.length < length) {
      result = '0' + result;
    }
    return result;
  };

  const fourYearsInMs = daysToMs(365 * 4 + 1);
  let year = 1970 + Math.floor(timestamp / fourYearsInMs) * 4;
  timestamp = timestamp % fourYearsInMs;

  while (true) {
    let isLeapYear = year % 4 === 0;
    let nextTimestamp = timestamp - daysToMs(isLeapYear ? 366 : 365);
    if (nextTimestamp < 0) {
      break;
    }
    timestamp = nextTimestamp;
    year = year + 1;
  }

  const daysByMonth = year % 4 === 0 ? leapYear : nonLeapYear;

  let month = 0;
  for (let i = 0; i < daysByMonth.length; i++) {
    const msInThisMonth = daysToMs(daysByMonth[i]);
    if (timestamp > msInThisMonth) {
      timestamp = timestamp - msInThisMonth;
    } else {
      month = i + 1;
      break;
    }
  }

  const date = Math.ceil(timestamp / daysToMs(1));
  timestamp = timestamp - daysToMs(date - 1);
  const hours = Math.floor(timestamp / hoursToMs(1));
  timestamp = timestamp - hoursToMs(hours);
  const minutes = Math.floor(timestamp / minToMs(1));
  timestamp = timestamp - minToMs(minutes);
  const sec = Math.floor(timestamp / secToMs(1));
  timestamp = timestamp - secToMs(sec);

  return (
    year +
    '-' +
    padStart(month, 2) +
    '-' +
    padStart(date, 2) +
    'T' +
    padStart(hours, 2) +
    ':' +
    padStart(minutes, 2) +
    ':' +
    padStart(sec, 2) +
    '+0000'
  );
}

function isValidValue(value) {
  const valueType = getType(value);
  return valueType !== 'null' && valueType !== 'undefined' && value !== '' && value === value;
}

function isConsentGivenOrNotRequired(data, eventData) {
  if (data.adStorageConsent !== 'required') return true;
  if (eventData.consent_state) return !!eventData.consent_state.ad_storage;
  const xGaGcs = eventData['x-ga-gcs'] || '';
  return xGaGcs[2] === '1';
}

function getUrl(eventData) {
  return eventData.page_location || getRequestHeader('referer') || eventData.page_referrer;
}

function shouldExitEarly(data, eventData) {
  if (!isConsentGivenOrNotRequired(data, eventData)) {
    data.gtmOnSuccess();
    return true;
  }

  const url = getUrl(eventData);
  if (url && url.lastIndexOf('https://gtm-msr.appspot.com/', 0) === 0) {
    data.gtmOnSuccess();
    return true;
  }
  return false;
}

function log(rawDataToLog) {
  rawDataToLog.TraceId = getRequestHeader('trace-id');
  logToConsole(JSON.stringify(rawDataToLog));
}
