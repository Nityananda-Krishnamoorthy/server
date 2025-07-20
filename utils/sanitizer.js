const createDOMPurify = require('dompurify');
const { JSDOM } = require('jsdom');

const window = new JSDOM('').window;
const DOMPurify = createDOMPurify(window);

const sanitize = (dirty) => {
  return DOMPurify.sanitize(dirty, {
    ALLOWED_TAGS: [
      'p', 'br', 'strong', 'em', 'u', 's', 'blockquote',
      'ol', 'ul', 'li', 'a', 'code', 'pre', 'span'
    ],
    ALLOWED_ATTR: ['href', 'class', 'target', 'rel'],
    FORBID_TAGS: ['style', 'script', 'iframe', 'object', 'embed'],
    FORBID_ATTR: ['style', 'onerror', 'onload'],
    ADD_ATTR: ['target', 'rel'],
    ADD_TAGS: ['span'],
    ALLOW_DATA_ATTR: false,
  });
};

module.exports = { sanitize };