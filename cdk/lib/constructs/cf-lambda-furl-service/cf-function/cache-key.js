// CloudFront Functions JS 2.0
// Combines Next.js RSC-related headers into a single hashed cache key header
// to prevent cache poisoning between HTML and RSC flight responses.
//
// Next.js App Router sets Vary: rsc, next-router-state-tree, next-router-prefetch,
// next-router-segment-prefetch (and next-url for interception routes).
// CloudFront ignores Vary and requires explicit cache key configuration,
// but its Cache Policy has a 10-header limit. This function hashes all
// RSC headers into one header to stay within the limit.
async function handler(event) {
  var h = event.request.headers;
  var parts = [
    'rsc',
    'next-router-prefetch',
    'next-router-state-tree',
    'next-router-segment-prefetch',
    'next-url',
  ];
  var key = '';
  for (var i = 0; i < parts.length; i++) {
    if (h[parts[i]]) {
      key += parts[i] + '=' + h[parts[i]].value + ';';
    }
  }
  if (key) {
    // FNV-1a hash (32-bit). Cryptographic strength is unnecessary;
    // we only need distinct cache keys for distinct header combinations.
    // See: https://en.wikipedia.org/wiki/Fowler%E2%80%93Noll%E2%80%93Vo_hash_function
    var FNV_OFFSET_BASIS = 2166136261;
    var FNV_PRIME = 16777619;
    var hash = FNV_OFFSET_BASIS;
    for (var j = 0; j < key.length; j++) {
      hash ^= key.charCodeAt(j);
      hash = (hash * FNV_PRIME) | 0;
    }
    event.request.headers['x-nextjs-cache-key'] = { value: String(hash >>> 0) };
  }
  return event.request;
}
