const jwt = require('jsonwebtoken')
const { TOKEN } = require('../config')

/**
 * @param {Object} info - 存储在token中的值
 */
exports.createToken = info => {
  const token = jwt.sign(info, TOKEN.secret, { expiresIn: TOKEN.expiresIn })
  return token;
}

/**
 * @param {Object} ctx - app.context
 * @param {Array} roleList - 需要具备的权限 { role: 1, verifyTokenBy: 'url' }
 *
 * @return {Boolean} 是否验证通过
 */
exports.checkToken = (req, res) => {
  let isVerify = true;
  let token = req.headers['authorization'];
  jwt.verify(token, TOKEN.secret, function(err, decoded) {
    if (err) {
      return false;
    } else if (decoded) {
      let expTime = decoded.exp;
      let currentTime = new Date().getTime();
      if (expTime > parseInt(currentTime / 1000)) {  // 当前时间小于过期时间，则token有效
        isVerify = true;
      } else {
        isVerify = false;
      }
    }
  })
  
  return isVerify;
}
