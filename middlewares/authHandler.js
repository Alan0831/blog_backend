const { checkToken } = require('../utils/token')
const { packageResponse } = require('../utils/packageRespponse');
/**
 * role === 1 需要权限的路由
 * @required 'all': get post put delete 均需要权限。
 */
const verifyList1 = [
  { regexp: /\/article\/output/, required: 'get', verifyTokenBy: 'url' }, // 导出文章 verifyTokenBy 从哪里验证 token
  { regexp: /\/article/, required: 'post, put, delete' }, // 普通用户 禁止修改或者删除、添加文章
  { regexp: /\/fragment/, required: 'post, put, delete' }, // 普通用户 禁止修改或者删除、添加文章
  { regexp: /\/discuss/, required: 'delete, post' }, // 普通用户 禁止删除评论
  { regexp: /\/user/, required: 'put, delete' }, // 普通用户 禁止获取用户、修改用户、以及删除用户
  { regexp: /\/monitor/, required: 'get' } // 普通用户 禁止获取用户、修改用户、以及删除用户
]

// role === 2 需要权限的路由
const verifyList2 = [
  { regexp: /\/discuss/, required: 'post' } // 未登录用户 禁止评论
]

/**
 * 检查路由是否需要权限，返回一个权限列表
 *
 * @return {Array} 返回 roleList
 */
function checkAuth(method, url) {
    function _verify(list, role) {
        const target = list.find(v => {
            return v.regexp.test(url) && (v.required === 'all' || v.required.toUpperCase().includes(method))
        })
        return target
    }
    const roleList = []
    const result1 = _verify(verifyList1)
    const result2 = _verify(verifyList2)

    result1 && roleList.push({ role: 1, verifyTokenBy: result1.verifyTokenBy || 'headers' })
    result2 && roleList.push({ role: 2, verifyTokenBy: result1.verifyTokenBy || 'headers' })

    return roleList
}

// auth example token eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoyLCJpZCI6MSwiaWF0IjoxNTY3MDcyOTE4LCJleHAiOjE1Njk2NjQ5MTh9.-V71bEfuUczUt_TgK0AWUJTbAZhDAN5wAv8RjmxfDKI
module.exports = async (req, res, next) => {
    // console.log('req' + JSON.parse(req))
    // console.log('res' + JSON.parse(res))
    if (checkToken(req, res)) {
        await next();
    } else {
        packageResponse('error', { data: {errorType: 'tokenInvalid'}, errorMessage: 'token失效' }, res);
    }
}
