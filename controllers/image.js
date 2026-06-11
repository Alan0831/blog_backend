const { article: ArticleModel, user: UserModel, sequelize } = require('../models')
const { packageResponse } = require('../utils/packageRespponse')
const {logger} = require('../middlewares/logger');

class ImageControllers {
    // 上传图片
    static async uploadImage(req, res, next) {
        if (req.file) {
            logger.info(`============${req.file.filename}图片上传成功============`);
            packageResponse('success', { data: req.file }, res);
        } else {
            packageResponse('error', {errorMessage: '上传图片失败'}, res);
        }
    }

    // 上传视频
    static async uploadVideo(req, res, next) {
        if (req.file) {
            logger.info(`============${req.file.filename}视频上传成功============`);
            packageResponse('success', { data: req.file }, res);
        } else {
            packageResponse('error', {errorMessage: '上传视频失败'}, res);
        }
    }
}

module.exports = ImageControllers;