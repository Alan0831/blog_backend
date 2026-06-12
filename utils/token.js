const jwt = require('jsonwebtoken')
const { TOKEN } = require('../config')

exports.createToken = info => {
  const token = jwt.sign(info, TOKEN.secret, { expiresIn: TOKEN.expiresIn })
  return token;
}

exports.checkToken = (req, res) => {
  let token = req.headers['authorization'];
  if (!token) return false;

  token = token.replace(/^Bearer\s+/i, '');

  try {
    const decoded = jwt.verify(token, TOKEN.secret);
    const currentTime = new Date().getTime();
    if (decoded.exp > parseInt(currentTime / 1000)) {
      req.user = decoded;
      return true;
    }
  } catch (err) {
    return false;
  }

  return false;
}
