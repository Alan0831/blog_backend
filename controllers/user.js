const { user: UserModel, sequelize } = require('../models')
const { packageResponse } = require('../utils/packageRespponse')
const { createToken } = require('../utils/token')
const joi = require('joi');
const schemaLogin = joi.object({
    username: joi.string().required().min(2).max(26),
    password: joi.string().pattern(/^[\S]{6,12}$/).required(),
})
const schemaRegister = joi.object({
    username: joi.string().required().min(2).max(26),
    email: joi.string().required().pattern(/^[a-zA-Z0-9_-]+@[a-zA-Z0-9_-]+(\.[a-zA-Z0-9_-]+)+$/),
    password: joi.string().pattern(/^[\S]{6,12}$/).required(),
    description: joi.string(),
})
const schemaEdit = joi.object({
    userId: joi.number().required(),
    email: joi.string().pattern(/^[a-zA-Z0-9_-]+@[a-zA-Z0-9_-]+(\.[a-zA-Z0-9_-]+)+$/),
    description: joi.string(),
})

class UserControllers {
    // 查找用户
    static find(params) {
        return UserModel.findOne({ where: params })
    }

    //  登录
    static async doLogin(req, res, next) {
        const { error } = schemaLogin.validate(req.body);
        if (error) {
            packageResponse('error', { errorMessage: `密码格式错误：${error}` }, res);
        } else {
            let data = await UserControllers.find({ username: req.body.username }) // 在数据库中查找该用户是否存在
            if (data) {
                if (data.password === req.body.password) {
                    const token = createToken({ username: data.username, userId: data.id, role: data.role }) // 生成 token
                    let loginObj = {
                        username: data.username, 
                        userId: data.id, 
                        role: data.role,
                        email: data.email,
                        disabledDiscuss: data.disabledDiscuss,
                        gender: data.gender,
                        token
                    };
                    packageResponse('success', { data: loginObj }, res);
                }
                else {
                    packageResponse('error', { errorMessage: '密码错误' }, res);
                }
            }
            else {
                packageResponse('error', { errorMessage: '该用户不存在' }, res);
            }
        }
    }

    //  注册
    static async doRegister(req, res, next) {
        const { error } = schemaRegister.validate(req.body);
        if (error) {
            packageResponse('error', { errorMessage: `${error}` }, res);
        } else {
            let data = await UserControllers.find({ username: req.body.username }) // 在数据库中查找该用户是否存在
            if (data) {
                packageResponse('error', { errorMessage: '该用户已存在' }, res);
            }
            else {
                const { username, password, email, description } = req.body;
                await UserModel.create({ username, password, email, description });
                packageResponse('success', { successMessage: '注册成功' }, res);
            }
        }
    }

    //  更新用户信息
    static async updateUser(req, res, next) {
        const { error } = schemaEdit.validate(req.body);
        if (error) {
            packageResponse('error', { errorMessage: `修改失败：${error}` }, res);
        } else {
            const { userId, email, description, disabledDiscuss } = req.body;
            // if (typeof disabledDiscuss !== 'undefined') {
            //     await IpModel.update({ auth: !disabledDiscuss }, { where: { userId: parseInt(userId) } })
            // }
            try {
                await UserControllers.updateUserById(userId, { disabledDiscuss, description, email });
                packageResponse('success', { successMessage: '修改成功' }, res);
            } catch (err) {
                packageResponse('error', { errorMessage: `修改失败：${err}` }, res);
            }
        }
    }
    static updateUserById(userId, data) {
        return UserModel.update(data, { where: { id: userId } })
    }
}

module.exports = UserControllers;