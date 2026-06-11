const { article: ArticleModel, video: VideoModel, comment: CommentModel, user: UserModel, reply: ReplyModel, collection: CollectionModel, sequelize } = require('../models')
const { packageResponse } = require('../utils/packageRespponse')
const joi = require('joi');
const { find } = require('../controllers/user')
const {logger} = require('../middlewares/logger');

const schemaUpdate = joi.object({
    collectionArticleId: joi.number().required(),
    owner: joi.number().required(),
});
const schemaUpdateVideo = joi.object({
    collectionVideoId: joi.number().required(),
    owner: joi.number().required(),
});
const schemaSearch = joi.object({
    owner: joi.number().required(),
});

class ArticleControllers {
    // 添加文章收藏
    static async addCollection(req, res, next) {
        const { error } = schemaUpdate.validate(req.body);
        if (error) {
            packageResponse('error', {errorMessage: error}, res);
        } else {
            const { collectionArticleId, owner } = req.body;
            let isCollected = await ArticleControllers.findIsCollection(owner, collectionArticleId, 1);
            if (isCollected) {
                packageResponse('success', { successMessage: '已收藏该文章' }, res);
                return;
            }
            try {
                await CollectionModel.create({ owner, articleId: collectionArticleId });
                // 文章收藏数、热度增加
                const articleData = await ArticleModel.findOne({where: { id: collectionArticleId }, attributes: ['collectionCount', 'recommend'],});
                ArticleModel.update({ collectionCount: ++articleData.collectionCount, recommend: ++articleData.recommend }, { where: { id: collectionArticleId } });
                logger.info(`============用户:${owner}对文章${collectionArticleId}收藏成功============`);
                packageResponse('success', { successMessage: '收藏成功！' }, res);
            } catch (err) {
                logger.info(`============用户:${owner}对文章${collectionArticleId}收藏失败============`);
                packageResponse('error', {errorMessage: '添加收藏失败: ' + err}, res);
            }
        }
    }

    // 添加视频收藏
    static async addVideoCollection(req, res, next) {
        const { error } = schemaUpdateVideo.validate(req.body);
        if (error) {
            packageResponse('error', {errorMessage: error}, res);
        } else {
            const { collectionVideoId, owner } = req.body;
            let isCollected = await ArticleControllers.findIsCollection(owner, collectionVideoId, 2);
            if (isCollected) {
                packageResponse('success', { successMessage: '已收藏该文章' }, res);
                return;
            }
            try {
                await CollectionModel.create({ owner, videoId: collectionVideoId });
                // 文章收藏数、热度增加
                const videoData = await VideoModel.findOne({where: { id: collectionVideoId }, attributes: ['collectionCount', 'recommend'],});
                console.log(videoData)
                VideoModel.update({ collectionCount: ++videoData.collectionCount, recommend: ++videoData.recommend }, { where: { id: collectionVideoId } });
                logger.info(`============用户:${owner}对文章${collectionVideoId}收藏成功============`);
                packageResponse('success', { successMessage: '收藏成功！' }, res);
            } catch (err) {
                logger.info(`============用户:${owner}对文章${collectionVideoId}收藏失败============`);
                packageResponse('error', {errorMessage: '添加收藏失败: ' + err}, res);
            }
        }
    }

    // 取消文章收藏
    static async deleteCollection(req, res, next) {
        const { error } = schemaUpdate.validate(req.body);
        if (error) {
            packageResponse('error', {errorMessage: error}, res);
        } else {
            const { collectionArticleId, owner } = req.body;
            let isCollected = await ArticleControllers.findIsCollection(owner, collectionArticleId, 1);
            if (!isCollected) {
                packageResponse('success', { successMessage: '未收藏该文章' }, res);
                return;
            }
            try {
                await CollectionModel.destroy({ where: { owner, articleId: collectionArticleId } });
                // 文章收藏数、热度减少
                const articleData = await ArticleModel.findOne({where: { id: collectionArticleId }, attributes: ['collectionCount'],});
                ArticleModel.update({ collectionCount: --articleData.collectionCount, recommend: --articleData.recommend }, { where: { id: collectionArticleId } });
                logger.info(`============用户:${owner}对文章${collectionArticleId}取消收藏成功============`);
                packageResponse('success', { successMessage: '取消收藏成功' }, res);
            } catch (err) {
                logger.info(`============用户:${owner}对文章${collectionArticleId}取消收藏失败============`);
                packageResponse('error', {errorMessage: '取消收藏失败: ' + err}, res);
            }
        }
    }

    // 取消视频收藏
    static async deleteVideoCollection(req, res, next) {
        const { error } = schemaUpdateVideo.validate(req.body);
        if (error) {
            packageResponse('error', {errorMessage: error}, res);
        } else {
            const { collectionVideoId, owner } = req.body;
            let isCollected = await ArticleControllers.findIsCollection(owner, collectionVideoId, 2);
            if (!isCollected) {
                packageResponse('success', { successMessage: '未收藏该文章' }, res);
                return;
            }
            try {
                await CollectionModel.destroy({ where: { owner, videoId: collectionVideoId } });
                // 文章收藏数、热度减少
                const videoData = await VideoModel.findOne({where: { id: collectionVideoId }, attributes: ['collectionCount'],});
                VideoModel.update({ collectionCount: --videoData.collectionCount, recommend: --videoData.recommend }, { where: { id: collectionVideoId } });
                logger.info(`============用户:${owner}对文章${collectionVideoId}取消收藏成功============`);
                packageResponse('success', { successMessage: '取消收藏成功' }, res);
            } catch (err) {
                logger.info(`============用户:${owner}对文章${collectionVideoId}取消收藏失败============`);
                packageResponse('error', {errorMessage: '取消收藏失败: ' + err}, res);
            }
        }
    }

    // 查询收藏
    static async searchCollection(req, res, next) {
        const { error } = schemaSearch.validate(req.body);
        if (error) {
            packageResponse('error', {errorMessage: error}, res);
        } else {
            const { owner } = req.body;
            // 查询两次，然后把文章收藏和视频收藏拼接
            const dataArticle = await CollectionModel.findAndCountAll({ 
                where: { owner, articleId: { $not: null} },
                include: [
                    {
                        model: ArticleModel,
                        as: 'article',
                        row: true,
                    },
                ],
                row: true,
                order: [['createdAt', 'DESC']]
            });
            const dataVideo = await CollectionModel.findAndCountAll({ 
                where: { owner, videoId: { $not: null} },
                include: [
                    {
                        model: VideoModel,
                        as: 'video',
                        row: true,
                    },
                ],
                row: true,
                order: [['createdAt', 'DESC']]
            });
            
            if (dataArticle && dataVideo) {
                let dataAll = {article: dataArticle, video: dataVideo};
                logger.info(`============用户:${owner}查询收藏${dataAll}============`);
                packageResponse('success', { data: dataAll}, res);
            } else {
                packageResponse('error', {errorMessage: '查询收藏失败！'}, res);
            }
        }
    }

    // 查询用户是否已经收藏文章/视频/题目
    static async findIsCollection(owner, id, type = 1) {
        if (type === 1) {
            let data = await CollectionModel.findOne({ where: {owner, articleId: id} });
            if (data) {
                return true;
            }
            return false;
        } else if (type === 2) {
            let data = await CollectionModel.findOne({ where: {owner, videoId: id} });
            if (data) {
                return true;
            }
            return false;
        } else if (type === 3) {
            let data = await CollectionModel.findOne({ where: {owner, codeId: id} });
            if (data) {
                return true;
            }
            return false;
        }
    }
}

module.exports = ArticleControllers;