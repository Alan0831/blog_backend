const { checkToken } = require('../utils/token')
const { packageResponse } = require('../utils/packageRespponse');

const METHOD = {
  GET: 'GET',
  POST: 'POST',
  PUT: 'PUT',
  DELETE: 'DELETE',
  ALL: 'ALL',
}

// Routes that need a valid token.
const verifyList1 = [
  { regexp: /\/createArticle$/, required: METHOD.POST },
  { regexp: /\/editArticle$/, required: METHOD.POST },
  { regexp: /\/deleteArticle$/, required: METHOD.POST },
  { regexp: /\/createArticleClassName$/, required: METHOD.POST },
  { regexp: /\/setArticleClass$/, required: METHOD.POST },
  { regexp: /\/createComment$/, required: METHOD.POST },
  { regexp: /\/deleteComment$/, required: METHOD.POST },
  { regexp: /\/createVideoComment$/, required: METHOD.POST },
  { regexp: /\/deleteVideoComment$/, required: METHOD.POST },
  { regexp: /\/updateUser$/, required: METHOD.POST },
  { regexp: /\/updateNotice$/, required: METHOD.POST },
  { regexp: /\/getNotice$/, required: METHOD.POST },
]

const verifyList2 = [
  { regexp: /\/createComment$/, required: METHOD.POST },
  { regexp: /\/createVideoComment$/, required: METHOD.POST },
]

function isMethodMatched(required, method) {
    return required === METHOD.ALL || required.toUpperCase().split(/\s*,\s*/).includes(method)
}

function checkAuth(method, url) {
    function _verify(list) {
        return list.find(v => {
            return v.regexp.test(url) && isMethodMatched(v.required, method)
        })
    }

    const roleList = []
    const result1 = _verify(verifyList1)
    const result2 = _verify(verifyList2)

    result1 && roleList.push({ role: 1, verifyTokenBy: result1.verifyTokenBy || 'headers' })
    result2 && roleList.push({ role: 2, verifyTokenBy: result2.verifyTokenBy || 'headers' })

    return roleList
}

module.exports = async (req, res, next) => {
    const roleList = checkAuth(req.method, req.path);

    if (roleList.length === 0) {
        await next();
        return;
    }

    if (checkToken(req, res)) {
        await next();
    } else {
        packageResponse('error', { data: {errorType: 'tokenInvalid'}, errorMessage: 'token失效' }, res);
    }
}
