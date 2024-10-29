const { article: ArticleModel, comment: CommentModel, user: UserModel, reply: ReplyModel, collection: CollectionModel, sequelize } = require('../models')
const { packageResponse } = require('../utils/packageRespponse')
const joi = require('joi');
const { find } = require('../controllers/user')

const schemaUpdate = joi.object({
    collectionArticleId: joi.number().required(),
    owner: joi.number().required(),
});
const schemaSearch = joi.object({
    owner: joi.number().required(),
});

class ArticleControllers {
    // 添加收藏
    static async addCollection(req, res, next) {
        const { error } = schemaUpdate.validate(req.body);
        if (error) {
            packageResponse('error', {errorMessage: error}, res);
        } else {
            const { collectionArticleId, owner } = req.body;
            let isCollected = await ArticleControllers.findIsCollection(owner, collectionArticleId);
            if (isCollected) {
                packageResponse('success', { successMessage: '已收藏该文章' }, res);
                return;
            }
            try {
                await CollectionModel.create({ owner, articleId: collectionArticleId });
                // 文章收藏数、热度增加
                const articleData = await ArticleModel.findOne({where: { id: collectionArticleId }, attributes: ['collectionCount', 'recommend'],});
                ArticleModel.update({ collectionCount: ++articleData.collectionCount, recommend: ++articleData.recommend }, { where: { id: collectionArticleId } });
                packageResponse('success', { successMessage: '收藏成功！' }, res);
            } catch (err) {
                packageResponse('error', {errorMessage: '添加收藏失败: ' + err}, res);
            }
        }
    }

    // 取消收藏
    static async deleteCollection(req, res, next) {
        const { error } = schemaUpdate.validate(req.body);
        if (error) {
            packageResponse('error', {errorMessage: error}, res);
        } else {
            const { collectionArticleId, owner } = req.body;
            let isCollected = await ArticleControllers.findIsCollection(owner, collectionArticleId);
            if (!isCollected) {
                packageResponse('success', { successMessage: '未收藏该文章' }, res);
                return;
            }
            try {
                await CollectionModel.destroy({ where: { owner, articleId: collectionArticleId } });
                // 文章收藏数、热度减少
                const articleData = await ArticleModel.findOne({where: { id: collectionArticleId }, attributes: ['collectionCount'],});
                ArticleModel.update({ collectionCount: --articleData.collectionCount, recommend: --articleData.recommend }, { where: { id: collectionArticleId } });
                packageResponse('success', { successMessage: '取消收藏成功' }, res);
            } catch (err) {
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
            const data = await CollectionModel.findAndCountAll({ 
                where: { owner },
                include: [
                    {
                        model: ArticleModel,
                        as: 'article',
                        row: true,
                    },
                ],
                row: true,
            },
            )
            if (data) {
                packageResponse('success', { data }, res);
            } else {
                packageResponse('error', {errorMessage: '查询收藏失败！'}, res);
            }
        }
    }

    // 查询用户是否已经收藏文章
    static async findIsCollection(owner, articleId) {
        let data = await CollectionModel.findOne({ where: {owner, articleId} });
        if (data) {
            return true;
        }
        return false;
    }
}

module.exports = ArticleControllers;