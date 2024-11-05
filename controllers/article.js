const { article: ArticleModel, comment: CommentModel, user: UserModel, reply: ReplyModel, articleclass: ArticleclassModel, sequelize } = require('../models')
const { packageResponse } = require('../utils/packageRespponse')
const joi = require('joi');
const { v4: uuidv4 } = require('uuid');
const { find } = require('../controllers/user');
const { findIsCollection } = require('../controllers/collection');


const schemaSearchArticle = joi.object({
    id: joi.number().required(),
    owner: joi.number().required(),
    // type: joi.number(), // type 用于区分是否增加浏览次数 1 新增浏览次数 0 不新增
});
const schemaCreateArticle = joi.object({
    authorId: joi.number().required(),
    title: joi.string().required(),
    content: joi.string().required(),
    categoryList: joi.string(),
    tagList: joi.array(),
    type: joi.boolean(),
    top: joi.boolean(),
    classId: joi.number(),
});
const schemaEditArticle = joi.object({
    articleId: joi.number().required(),
    authorId: joi.number().required(),
    title: joi.string().required(),
    content: joi.string().required(),
    categoryList: joi.string(),
    tagList: joi.array(),
    type: joi.boolean(),
    top: joi.boolean(),
    oldClassId: joi.number(),
    classId: joi.number(),
});
const schemaDeleteArticle = joi.object({
    articleId: joi.number().required(),
});
const schemaCreateArticleClassName = joi.object({
    className: joi.string().required(),
    userId: joi.number().required(),
});
const schemaSearchArticleClassName = joi.object({
    userId: joi.number().required(),
});
const schemaSetArticleClass = joi.object({
    articleId: joi.number().required(),
    classId: joi.number().required(),
    userId: joi.number().required(),
    oldClassId: joi.number(),
});

class ArticleControllers {
    //  获取文章列表
    static async getArticleList(req, res, next) {
        const { pageNum = 1, pageSize = 10, preview = 1, keyword = '', userId = ''} = req.body;
        let articleOrder = [['createdAt', 'DESC']];
        let author = '';
        let findParam = {};
        // 如果传值有userId，则查询对应的author
        if (userId) {
            const authorData = await find({id: userId});
            if (!authorData) return;
            author = authorData.username;
            findParam =  {
                where: {
                    author
                },
                include: [
                    // { model: TagModel, attributes: ['name'], where: tagFilter },
                    {
                        model: CommentModel,
                        attributes: ['id', 'content', 'createdAt'],
                        include: [{ model: ReplyModel, attributes: ['id'] }]
                    }
                ],
                offset: (pageNum - 1) * pageSize,
                limit: parseInt(pageSize),
                order: articleOrder,
                row: true,
                distinct: true // count 计算
            };
        } else {
            findParam =  {
                where: {
                    id: {
                        $not: -1 // 过滤关于页面的副本
                    },
                    $or: {
                        title: {
                            $like: `%${keyword}%`
                        },
                        content: {
                            $like: `%${keyword}%`
                        },
                    },
                },
                include: [
                    // { model: TagModel, attributes: ['name'], where: tagFilter },
                    {
                        model: CommentModel,
                        attributes: ['id', 'content', 'createdAt'],
                        include: [{ model: ReplyModel, attributes: ['id'] }]
                    }
                ],
                offset: (pageNum - 1) * pageSize,
                limit: parseInt(pageSize),
                order: articleOrder,
                row: true,
                distinct: true // count 计算
            };
        }

        // 如果是查询个人文章列表，则不返回文章内容
        if (author) {
            findParam.attributes = {exclude: ['content']};
        }
        if (Object.keys(findParam).length === 0) {
            packageResponse('success', { data: {} }, res);
        } else {
            const data = await ArticleModel.findAndCountAll(findParam);
            if (preview === 1 && !author) {
                data.rows.forEach(d => {
                 d.content = d.content.slice(0, 500); // 预览模式减少传输数据
                })
            }
            data.pageSize = pageSize;
            data.pageNum = pageNum;
            packageResponse('success', { data }, res);
        }
    }

    //   获取推荐文章列表
    static async getRecommendArticleList(req, res, next) {
        let articleOrder = [['recommend', 'DESC']];
        let findParam = {
            attributes: {exclude: ['content']},
            limit: 6,
            order: articleOrder,
            row: true,
            distinct: true // count 计算
        };
        try {
            const data = await ArticleModel.findAndCountAll(findParam);
            packageResponse('success', { data }, res);
        } catch (err) {
            packageResponse('error', {errorMessage: err}, res);
        }
        
    }

    // 获取文章详情
    static async findArticleById(req, res, next) {
        const { error } = schemaSearchArticle.validate(req.body);
        if (error) {
            packageResponse('error', {errorMessage: error}, res);
        } else {
            const { id, owner } = req.body;
            const isCollected = await findIsCollection(owner, id);
            const data = await ArticleModel.findOne({
                where: { id },
                include: [
                    // 查找 分类 标签 评论 回复...
                    // { model: TagModel, attributes: ['name'] },
                    // { model: CategoryModel, attributes: ['name'] },
                    {
                        model: CommentModel,
                        attributes: ['id', 'content', 'createdAt'],
                        include: [
                            {
                                model: ReplyModel,
                                attributes: ['id', 'content', 'createdAt'],
                                include: [{ model: UserModel, as: 'user', attributes: { exclude: ['updatedAt', 'password'] } }],
                            },
                            { model: UserModel, as: 'user', attributes: { exclude: ['updatedAt', 'password'] } },
                        ],
                        row: true,
                    },
                    { model: UserModel, as: 'user', attributes: { exclude: ['updatedAt', 'password'] } },
                ],
                order: [[CommentModel, 'createdAt', 'DESC'], [[CommentModel, ReplyModel, 'createdAt', 'ASC']]], // comment model order
                row: true,
            });

            if (data) {
                // 更新点击数和热度
                ArticleModel.update({ viewCount: ++data.viewCount, recommend: ++data.recommend }, { where: { id } });
                let _data = {...data.dataValues, isCollected};
                packageResponse('success', { data: _data }, res);
            } else {
                packageResponse('error', {errorMessage: '该文章已不存在！'}, res);
            }
        }
    }

    // 创建文章
    static async createArticle(req, res, next) {
        const { error } = schemaCreateArticle.validate(req.body);

        if (!error) {
            const { title, content, classId = null, tagList = [], authorId, type, top } = req.body;
            const result = await ArticleModel.findOne({ where: { title } });
            console.log(result);
            if (result) {
                packageResponse('error', {errorMessage: '创建失败，该文章已存在！'}, res);
            } else {
                try {
                    const tags = tagList || [];
                    // const categories = categoryList.map(c => ({ name: c }))
                    const uuid = uuidv4().toString().replace(/-/g, '');
                    const authorData = await find({id: authorId});
                    if (authorData) {
                        const data = await ArticleModel.create(
                            { title, content, articleclassId: classId, tagList: JSON.stringify(tags), author: authorData.username, userId: authorId },
                        )
                        //  如果传了classId，则更新文章归属大类
                        if (classId) {
                            await ArticleControllers._setArticleClass(data.id, classId, authorId);
                        }
                        packageResponse('success', { data, successMessage: '创建文章成功' }, res);
                    } else {
                        packageResponse('error', { errorMessage: '创建文章失败: 未找到该作者'}, res);
                    }
                } catch (err) {
                    packageResponse('error', { errorMessage: '创建文章失败: ' + err }, res);
                }
                
            }
        } else {
            packageResponse('error', { errorMessage: '创建文章失败: ' + error }, res);
        }
    }

    // 修改文章
    static async editArticle(req, res, next) {
        const { error } = schemaEditArticle.validate(req.body);
        if (!error) {
            const { articleId, title, content, oldClassId = null, classId = null, tagList = [], authorId, type, top } = req.body;
            try {
                const tags = tagList || [];
                const data = await ArticleModel.update({ title, content, articleclassId: classId, tagList: JSON.stringify(tags), }, { where: { id: articleId } });
                //  如果传了classId，则更新文章归属大类
                if (classId) {
                    await ArticleControllers._updateArticleClass(data.id, oldClassId, classId, authorId);
                }
                packageResponse('success', { successMessage: '修改文章成功' }, res);
            } catch (err) {
                packageResponse('error', { errorMessage: '修改文章失败: ' + err }, res);
            }
        } else {
            packageResponse('error', { errorMessage: '修改文章失败: ' + error }, res);
        }
    }

    // 删除文章
    static async deleteArticle(req, res, next) {
        const { error } = schemaDeleteArticle.validate(req.body);
        if (!error) {
            const { articleId } = req.body;
            try {
                // await sequelize.query(
                //     `delete comment, reply, category, tag, article
                //     from article
                //     left join reply on article.id=reply.articleId
                //     left join comment on article.id=comment.articleId
                //     left join category on article.id=category.articleId
                //     left join tag on article.id=tag.articleId
                //     where article.id=${articleId}`
                // );
                await sequelize.query(
                    `delete comment, reply, article
                    from article
                    left join reply on article.id=reply.articleId
                    left join comment on article.id=comment.articleId
                    where article.id=${articleId}`
                );
                packageResponse('success', { successMessage: '删除文章成功' }, res);
            } catch (err) {
                packageResponse('error', { errorMessage: '删除文章失败: ' + err }, res);
            }
        } else {
            packageResponse('error', { errorMessage: '删除文章失败: ' + error }, res);
        }
    }

    // 创建文章大类
    static async createArticleClassName(req, res, next) {
        const { error } = schemaCreateArticleClassName.validate(req.body);
        if (!error) {
            const { className, userId } = req.body;
            try {
                const data = await ArticleclassModel.create(
                    { className, userId },
                )
                packageResponse('success', { data, successMessage: '创建文章大类成功' }, res);
            } catch (err) {
                packageResponse('error', { errorMessage: '创建文章大类失败: ' + err }, res);
            }
        } else {
            packageResponse('error', { errorMessage: '创建文章大类失败: ' + error }, res);
        }
    }

    //  查询文章大类
    static async searchArticleClassName(req, res, next) {
        const { error } = schemaSearchArticleClassName.validate(req.body);
        if (!error) {
            const { userId } = req.body;
            try {
                const data = await ArticleclassModel.findAndCountAll({
                    where: { userId }
                })
                packageResponse('success', { data }, res);
            } catch (err) {
                packageResponse('error', { errorMessage: err }, res);
            }
        } else {
            packageResponse('error', { errorMessage: error }, res);
        }
    }

    //  设置文章归属大类
    static async setArticleClass(req, res, next) {
        const { error } = schemaSetArticleClass.validate(req.body);
        if (!error) {
            const { articleId, oldClassId, classId, userId } = req.body;
            try {
                await ArticleModel.update({ articleclassId: classId }, { where: { id: articleId } });
                if (oldClassId != -1) {
                    await ArticleControllers._updateArticleClass(articleId, oldClassId, classId, userId);
                } else {
                    await ArticleControllers._setArticleClass(articleId, classId, userId);
                }
                
                packageResponse('success', { successMessage: '设置成功' }, res);
            } catch (err) {
                packageResponse('error', { errorMessage: '设置文章大类失败: ' + err }, res);
            }
        } else {
            packageResponse('error', { errorMessage: '设置文章大类失败: ' + error }, res);
        }
    }

    // 在文章归属大类内插入文章ID
    static async _setArticleClass(articleId, classId, userId) {
        try {
            const articleClassData = await ArticleclassModel.findOne({
                where: {id: classId, userId}
            });
            if (articleClassData) {
                if (articleClassData.articleList && JSON.parse(articleClassData.articleList).length !== 0) {
                    let list = JSON.parse(articleClassData.articleList);
                    list.push(articleId);
                    list = JSON.stringify(list);
                    await articleClassData.update({ articleList: list }, { where: { id: classId, userId } });
                } else {
                    let list =  JSON.stringify([articleId]);
                    await articleClassData.update({ articleList: list }, { where: { id: classId, userId } });
                }
                
            }
        } catch(err) {
            throw new Error(err);
        }
    }

    // 更新文章归属大类内插入文章ID
    static async _updateArticleClass(articleId, oldClassId, classId, userId) {
        try {
            const articleClassData = await ArticleclassModel.findOne({
                where: {id: classId, userId}
            });
            const oldArticleClassData = await ArticleclassModel.findOne({
                where: {id: oldClassId, userId}
            });
            if (articleClassData) {
                if (articleClassData.articleList && JSON.parse(articleClassData.articleList).length !== 0) {
                    let list = JSON.parse(articleClassData.articleList);
                    list.push(articleId);
                    list = JSON.stringify(list);
                    await articleClassData.update({ articleList: list }, { where: { id: classId, userId } });
                } else {
                    let list =  JSON.stringify([articleId]);
                    await articleClassData.update({ articleList: list }, { where: { id: classId, userId } });
                }
            }
            if (oldArticleClassData) {
                if (oldArticleClassData.articleList && JSON.parse(oldArticleClassData.articleList).length !== 0) {
                    let oldList = JSON.parse(oldArticleClassData.articleList);
                    console.log(oldList);
                    let _oldList = oldList.filter((item) => item != articleId);
                    _oldList = JSON.stringify(_oldList);
                    console.log(_oldList);
                    
                    await oldArticleClassData.update({ articleList: _oldList }, { where: { id: oldClassId, userId } });
                }
            }
        } catch(err) {
            throw new Error(err);
        }
    }
}

module.exports = ArticleControllers;