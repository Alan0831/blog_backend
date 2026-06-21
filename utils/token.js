const jwt = require('jsonwebtoken')
const { TOKEN } = require('../config')

function normalizeToken(token) {
  if (Array.isArray(token)) token = token[0];
  if (!token || typeof token !== 'string') return '';
  return token.replace(/^Bearer\s+/i, '').trim();
}

function getTokenFromRequest(req) {
  return normalizeToken(
    req.headers['authorization'] ||
    req.headers['token'] ||
    req.headers['x-token'] ||
    req.headers['x-access-token'] ||
    (req.cookies && req.cookies.token) ||
    (req.body && req.body.token) ||
    (req.query && req.query.token)
  );
}

exports.normalizeToken = normalizeToken;
exports.getTokenFromRequest = getTokenFromRequest;

exports.createToken = info => {
  const token = jwt.sign(info, TOKEN.secret, { expiresIn: TOKEN.expiresIn })
  return token;
}

exports.getTokenMeta = token => {
  const decoded = jwt.decode(normalizeToken(token)) || {};
  return {
    expiresIn: TOKEN.expiresIn,
    expiresAt: decoded.exp ? decoded.exp * 1000 : null,
  };
}

exports.verifyToken = req => {
  const token = getTokenFromRequest(req);
  if (!token) {
    return {
      valid: false,
      errorType: 'tokenMissing',
      errorCode: 'TOKEN_MISSING',
      errorMessage: '请先登录',
    };
  }

  try {
    const decoded = jwt.verify(token, TOKEN.secret);
    req.user = decoded;
    return { valid: true, decoded };
  } catch (err) {
    if (err && err.name === 'TokenExpiredError') {
      return {
        valid: false,
        errorType: 'tokenExpired',
        errorCode: 'TOKEN_EXPIRED',
        errorMessage: '登录已过期，请重新登录',
        expiredAt: err.expiredAt ? err.expiredAt.getTime() : null,
      };
    }

    return {
      valid: false,
      errorType: 'tokenInvalid',
      errorCode: 'TOKEN_INVALID',
      errorMessage: '登录状态无效，请重新登录',
    };
  }
}

exports.checkToken = req => {
  return exports.verifyToken(req).valid;
}
