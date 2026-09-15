const computeEffectiveTldPlusOne = require('computeEffectiveTldPlusOne');
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
const toBase64 = require('toBase64');

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
  if (param) return param;

  const cookieValue = getCookieValues(cookieName)[0];
  if (cookieValue) return cookieValue;

  return undefined;
}

function setAttributionCookie(paramName, cookieName) {
  const url = getUrl(eventData);
  const param = getQueryParam(url, paramName);
  if (!param) return;

  setCookie(cookieName, param, {
    domain: getCookieDomain(data, eventData),
    path: '/',
    secure: true,
    httpOnly: !!data.cookieHttpOnly,
    'max-age': 60 * 60 * 24 * (makeInteger(data.cookieExpiration) || 90)
  });
}

function cacheAttributionIds() {
  setAttributionCookie('mcID', 'cordial_mcID');
  setAttributionCookie('linkID', 'cordial_linkID');
}

function createContact(eventData) {
  const autoMap = data.autoMapEventData;
  const eventDataUserData = eventData.user_data || {};
  const email =
    data.address ||
    (autoMap
      ? eventData.email || eventDataUserData.email || eventDataUserData.email_address
      : undefined);

  if (!requireValue(email, 'address', '🛑 [ERROR] Contact was not created.')) return true;

  const contactData = mapContactData();
  contactData.channels = contactData.channels || {};
  contactData.channels.email = contactData.channels.email || {};
  contactData.channels.email.address = makeString(email);

  sendRequest('POST', 'contacts', contactData);
  return false;
}

function updateContact() {
  if (data.useSecondaryIdentifier) {
    if (
      !requireValue(data.secondaryKeyName, 'secondaryKeyName', '🛑 [ERROR] Contact was not updated.') ||
      !requireValue(data.secondaryKeyValue, 'secondaryKeyValue', '🛑 [ERROR] Contact was not updated.')
    ) {
      return true;
    }
  } else if (!requireValue(data.primaryKey, 'primaryKey', '🛑 [ERROR] Contact was not updated.')) {
    return true;
  }

  const identifier = getContactIdentifier();
  const contactData = mapContactData();

  sendRequest('PUT', 'contacts/' + identifier, contactData);
  return false;
}

function getContactIdentifier() {
  if (data.useSecondaryIdentifier) {
    return (
      encodeUriComponent(data.secondaryKeyName) + ':' + encodeUriComponent(data.secondaryKeyValue)
    );
  }

  const parts = makeString(data.primaryKey).split(':');
  if (parts.length === 2) {
    return encodeUriComponent(parts[0]) + ':' + encodeUriComponent(parts[1]);
  }

  return encodeUriComponent(data.primaryKey);
}

function mapContactData() {
  const contactData = {};
  const emailChannel = {};

  if (data.createContactParameters && data.createContactParameters.length) {
    const fields = makeTableMap(data.createContactParameters, 'key', 'value');
    for (let key in fields) {
      if (key === 'subscribeStatus') {
        emailChannel.subscribeStatus = fields[key];
      } else if (key === 'invalid') {
        emailChannel.invalid = coerceBooleanValue(fields[key]);
      } else if (key === 'address') {
        emailChannel.address = makeString(fields[key]);
      } else if (key === 'identifyBy') {
        if (data.eventType === 'createContact') {
          contactData.identifyBy = fields[key]
            .split(',')
            .map((secondaryKey) => secondaryKey.trim())
            .filter(isValidValue);
        }
      } else {
        contactData[key] = coerceBooleanValue(fields[key]);
      }
    }
  }

  let hasEmailChannelFields = false;
  for (let key in emailChannel) {
    hasEmailChannelFields = true;
    break;
  }
  if (hasEmailChannelFields) contactData.channels = { email: emailChannel };

  return contactData;
}

function coerceBooleanValue(value) {
  if (value === 'true' || value === true) return true;
  if (value === 'false' || value === false) return false;
  return value;
}

function trackOrder(eventData) {
  const mappedOrderData = mapOrderData(eventData);

  if (!requireValue(mappedOrderData.orderID, 'orderId', '🛑 [ERROR] Order was not sent.')) {
    return true;
  }

  if (
    !requireOneOf(
      [mappedOrderData.email, mappedOrderData.cID],
      '"email" or "cID"',
      '🛑 [ERROR] Order was not sent.'
    )
  ) {
    return true;
  }

  sendRequest('POST', 'orders', mappedOrderData);
  return false;
}

function mapOrderData(eventData) {
  const autoMap = data.autoMapEventData;
  const orderId = data.orderId || (autoMap ? eventData.transaction_id : undefined);
  const mcID = getAttributionParam('mcID', 'cordial_mcID', getMappedOrderProperty('mcId'));
  const linkID = getAttributionParam('linkID', 'cordial_linkID', getMappedOrderProperty('linkId'));
  const msID = getMappedOrderProperty('msId');
  const eventDataUserData = eventData.user_data || {};
  const mappedData = {};

  if (orderId) mappedData.orderID = makeString(orderId);

  mappedData.purchaseDate = data.purchaseDate
    ? makeString(data.purchaseDate)
    : convertTimestampToISO(getTimestampMillis());

  const email =
    data.email ||
    (autoMap
      ? eventData.email || eventDataUserData.email || eventDataUserData.email_address
      : undefined);
  if (isValidValue(email)) mappedData.email = email;

  if (isValidValue(data.cid)) mappedData.cID = data.cid;

  const customerID = getMappedOrderProperty('clientId') || (autoMap ? eventData.user_id : undefined);
  if (customerID) mappedData.customerID = makeString(customerID);

  if (mcID) mappedData.mcID = makeString(mcID);
  if (linkID) mappedData.linkID = makeString(linkID);
  if (msID) mappedData.msID = makeString(msID);

  const storeID = getMappedOrderProperty('storeId');
  if (storeID) mappedData.storeID = makeString(storeID);

  const status = getMappedOrderProperty('status');
  if (status) mappedData.status = makeString(status);

  const suppressTriggers = getMappedOrderProperty('suppressTriggers');
  if (suppressTriggers) mappedData.suppressTriggers = coerceBooleanValue(suppressTriggers);

  const discountAmount = getMappedOrderProperty('discountAmount');
  if (discountAmount) {
    mappedData.discountApplication = { type: 'fixed', amount: makeNumber(discountAmount) };
  }

  const totalAmount =
    getMappedOrderProperty('totalAmount') || (autoMap ? eventData.value : undefined);
  if (isValidValue(totalAmount)) mappedData.totalAmount = makeNumber(totalAmount);

  const tax = getMappedOrderProperty('tax');
  if (tax) mappedData.tax = makeNumber(tax);

  const shippingCost =
    getMappedOrderProperty('shippingCost') || (autoMap ? eventData.shipping : undefined);
  if (isValidValue(shippingCost)) mappedData.shippingAndHandling = makeNumber(shippingCost);

  const shippingAddress = mapAddress('shipping');
  if (shippingAddress) mappedData.shippingAddress = shippingAddress;

  const billingAddress = mapAddress('billing');
  if (billingAddress) mappedData.billingAddress = billingAddress;

  if (data.orderCustomProperties && data.orderCustomProperties.length) {
    mappedData.properties = makeTableMap(data.orderCustomProperties, 'key', 'value');
  }

  const items = getMappedOrderProperty('items') || (autoMap ? eventData.items : undefined);
  if (getType(items) === 'array') mappedData.items = formatItems(items);
  return mappedData;
}

function mapAddress(prefix) {
  const suffixToField = {
    Name: 'name',
    AddressLine: 'address',
    City: 'city',
    State: 'state',
    PostalCode: 'postalCode',
    Country: 'country'
  };

  const address = {};
  for (let suffix in suffixToField) {
    const value = getMappedOrderProperty(prefix + suffix);
    if (value) address[suffixToField[suffix]] = makeString(value);
  }

  let hasFields = false;
  for (let key in address) {
    hasFields = true;
    break;
  }
  return hasFields ? address : undefined;
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
      } else if (key === 'salePrice') {
        formattedItem.salePrice = makeNumber(item[key]);
      } else if (key === 'amount') {
        formattedItem.amount = makeNumber(item[key]);
      } else if (key === 'productType') {
        formattedItem.productType = makeString(item[key]);
      } else if (key === 'manufacturerName') {
        formattedItem.manufacturerName = makeString(item[key]);
      } else if (key === 'UPCCode' || key === 'upc') {
        formattedItem.UPCCode = makeString(item[key]);
      } else if (key === 'inStock' || key === 'taxable' || key === 'enabled') {
        formattedItem[key] = coerceBooleanValue(item[key]);
      } else if (key === 'description' || key === 'url' || key === 'images' || key === 'tags') {
        formattedItem[key] = item[key];
      } else {
        customProperties[key] = item[key];
      }
    }

    if (formattedItem.amount === undefined && formattedItem.qty && formattedItem.itemPrice) {
      formattedItem.amount = makeNumber(formattedItem.qty * formattedItem.itemPrice);
    }

    if (formattedItem.sku === undefined && formattedItem.productID) {
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
      const parsedBody = JSON.parse(responseBody || '{}');

      if (!data.useOptimisticScenario) {
        if (statusCode >= 200 && statusCode < 400 && !parsedBody.errors) {
          return data.gtmOnSuccess();
        } else {
          return data.gtmOnFailure();
        }
      }
    },
    {
      headers: {
        Authorization: 'Basic ' + toBase64(data.apiKey + ':'),
        'Content-Type': 'application/json'
      },
      method: method
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

function requireValue(value, paramName, failMessage) {
  if (isValidValue(value)) return true;
  log({
    Name: 'Cordial',
    Type: 'Message',
    Message: failMessage,
    Reason: 'Missing required parameter: "' + paramName + '".'
  });
  data.gtmOnFailure();
  return false;
}

function requireOneOf(values, identifierDescription, failMessage) {
  for (let i = 0; i < values.length; i++) {
    if (isValidValue(values[i])) return true;
  }
  log({
    Name: 'Cordial',
    Type: 'Message',
    Message: failMessage,
    Reason: 'Missing required identifier: ' + identifierDescription + '.'
  });
  data.gtmOnFailure();
  return false;
}

function isValidValue(value) {
  const valueType = getType(value);
  if (valueType === 'null' || valueType === 'undefined' || value !== value) return false;
  return value !== '' && value !== 'undefined' && value !== 'null';
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

function getCookieDomain(data, eventData) {
  return !data.cookieDomain || data.cookieDomain === 'auto'
    ? computeEffectiveTldPlusOne(getUrl(eventData)) || 'auto'
    : data.cookieDomain;
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
