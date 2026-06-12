const { article: ArticleModel, comment: CommentModel, user: UserModel, tag: TagModel, reply: ReplyModel, articleclass: ArticleclassModel, friendcircle: FriendCircleModel, privacyarticle: PrivacyArticleModel, sequelize } = require('../models')
const { packageResponse } = require('../utils/packageRespponse')
const joi = require('joi');
const { v4: uuidv4 } = require('uuid');
const { find } = require('../controllers/user');
const { findIsCollection } = require('../controllers/collection');
const { logger } = require('../middlewares/logger');
const { normalizePartition, getPartitionWhere } = require('../utils/partition');

function parseTagList(tagList) {
    if (Array.isArray(tagList)) return tagList;
    if (!tagList) return [];
    try {
        return JSON.parse(tagList);
    } catch (err) {
        return [];
    }
}

function pickDefined(data) {
    return Object.keys(data).reduce((result, key) => {
        if (data[key] !== undefined) {
            result[key] = data[key];
        }
        return result;
    }, {});
}

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
    classId: joi.number().allow(null, ''),
    visibleType: joi.number(),
    password: joi.string().allow(null, ''),
    articleCover: joi.string().allow(null, ''),
    partition: joi.string().allow(null, ''),
});
const schemaEditArticle = joi.object({
    articleId: joi.number().required(),
    authorId: joi.number().required(),
    title: joi.string(),
    content: joi.string(),
    categoryList: joi.string(),
    tagList: joi.array(),
    type: joi.boolean(),
    top: joi.boolean(),
    oldClassId: joi.number(),
    classId: joi.number().allow(null, ''),
    visibleType: joi.number().allow(null, ''),
    password: joi.string().allow(null, ''),
    articleCover: joi.string().allow(null, ''),
    partition: joi.string().allow(null, ''),
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
const schemaValidateArticleLock = joi.object({
    articleId: joi.number().required(),
    password: joi.string().required(),
});
const schemaSearchLikeArticle = joi.object({
    articleId: joi.number().required(),
});

class ArticleControllers {
    //  获取文章列表
    static async getArticleList(req, res, next) {
        const { pageNum = 1, pageSize = 10, preview = 1, keyword = '', userId = '', partition } = req.body;
        const partitionWhere = getPartitionWhere(partition);
        let localIP = req?.socket?.remoteAddress || '';
        let articleOrder = [['createdAt', 'DESC']];
        let author = '';
        let findParam = {};
        // 如果传值有userId，则查询对应的author
        if (userId) {
            logger.info(`============userId为:${userId},IP为${localIP}的用户开始请求文章列表============`);
            const authorData = await find({ id: userId });
            if (!authorData) return;
            author = authorData.username;
            findParam = {
                where: {
                    author,
                    ...partitionWhere,
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
            logger.info(`============IP为${localIP}的用户开始请求文章列表============`);
            findParam = {
                where: {
                    id: { $not: -1 },   // 过滤关于页面的副本
                    visibleType: { $not: 3 },
                    ...partitionWhere,
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
            findParam.attributes = { exclude: ['content'] };
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

    //  获取alan的文章
    static async getArticleListFromAlan(req, res, next) {
        const { pageNum = 1, pageSize = 10 } = req.body;
        let articleOrder = [['createdAt', 'DESC']];
        let findParam = {
            where: {
                author: 'alan',
                visibleType: { $not: 3 }
            },
            include: [
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
        try {
            const data = await ArticleModel.findAndCountAll(findParam);
            data.pageSize = pageSize;
            data.pageNum = pageNum;
            packageResponse('success', { data }, res);
        } catch (err) {
            packageResponse('error', { errorMessage: err }, res);
        }
    }

    //   获取推荐文章列表
    static async getRecommendArticleList(req, res, next) {
        const { partition } = req.body;
        let articleOrder = [['recommend', 'DESC']];
        let findParam = {
            where: { visibleType: { $not: 3 }, ...getPartitionWhere(partition) },
            attributes: { exclude: ['content'] },
            limit: 6,
            order: articleOrder,
            row: true,
            distinct: true // count 计算
        };
        try {
            const data = await ArticleModel.findAndCountAll(findParam);
            packageResponse('success', { data }, res);
        } catch (err) {
            packageResponse('error', { errorMessage: err }, res);
        }

    }

    // 获取文章详情
    static async findArticleById(req, res, next) {
        const { error } = schemaSearchArticle.validate(req.body);
        let localIP = req?.socket?.remoteAddress || '';
        if (error) {
            packageResponse('error', { errorMessage: error }, res);
        } else {
            const { id, owner } = req.body;
            logger.info(`============用户ID:${owner},IP为${localIP}请求文章:${id}============`);
            const isCollected = await findIsCollection(owner, id, 1);
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
                                attributes: ['id', 'content', 'createdAt', 'replyTo', 'replyUser'],
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
                ArticleModel.update({ viewCount: ++data.viewCount, recommend: ++data.recommend }, { where: { id }, silent: true });
                let _data = {
                    ...data.dataValues,
                    isCollected,
                    id: data.id,
                    title: data.title || '',
                    content: data.content || '',
                    tagList: parseTagList(data.tagList),
                    visibleType: data.visibleType,
                    partition: normalizePartition(data.partition),
                    articleCover: data.articleCover || '',
                    articleclassId: data.articleclassId || null,
                };
                packageResponse('success', { data: _data }, res);
            } else {
                packageResponse('error', { errorMessage: '该文章已不存在！' }, res);
            }
        }
    }

    // 创建文章
    static async createArticle(req, res, next) {
        const { error } = schemaCreateArticle.validate(req.body);

        if (!error) {
            const { title, content, classId = null, tagList = [], authorId, visibleType, password, articleCover, type, top, partition } = req.body;
            const normalizedPartition = normalizePartition(partition);
            const result = await ArticleModel.findOne({ where: { title } });
            console.log(result);
            logger.info(`============用户ID:${authorId}创建文章============`);
            if (result) {
                logger.info(`============用户ID:${authorId}创建文章失败，文章已存在============`);
                packageResponse('error', { errorMessage: '创建失败，该文章已存在！' }, res);
            } else {
                try {
                    const tags = tagList || [];
                    // 新增tag标签
                    tags.map(async (item) => {
                        let currentTag = await TagModel.findOne({where: {tagName: item}});
                        if (!currentTag) {
                            await TagModel.create({tagName: item});
                        }
                    });
                    // const categories = categoryList.map(c => ({ name: c }))
                    const uuid = uuidv4().toString().replace(/-/g, '');
                    const authorData = await find({ id: authorId });
                    if (authorData) {
                        const data = await ArticleModel.create(
                            { title, content, articleCover, visibleType, articleclassId: classId, tagList: JSON.stringify(tags), partition: normalizedPartition, author: authorData.username, userId: authorId },
                        )
                        //  如果传了classId，则更新文章归属大类
                        if (classId) {
                            await ArticleControllers._setArticleClass(data.id, classId, authorId);
                        }
                        //  如果设置了加锁，则设置密码
                        if (visibleType === 2) {
                            await ArticleControllers.setArticleLock(data.id, authorId, password);
                        }

                        // 记录到朋友圈
                        FriendCircleModel.create({ userId: authorId, articleId: data.id, type: 1 });
                        packageResponse('success', { data, successMessage: '创建文章成功' }, res);
                    } else {
                        packageResponse('error', { errorMessage: '创建文章失败: 未找到该作者' }, res);
                    }
                } catch (err) {
                    logger.info(`============用户ID:${authorId}创建文章失败:${err}`);
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
            const { articleId, title, content, oldClassId = null, articleCover, visibleType, password, classId = null, tagList, authorId, type, top, partition } = req.body;
            try {
                const updateData = pickDefined({
                    title,
                    content,
                    articleCover,
                    visibleType,
                    partition: Object.prototype.hasOwnProperty.call(req.body, 'partition') ? normalizePartition(partition) : undefined,
                });

                if (Object.prototype.hasOwnProperty.call(req.body, 'classId')) {
                    updateData.articleclassId = classId;
                }

                if (Object.prototype.hasOwnProperty.call(req.body, 'tagList')) {
                    updateData.tagList = JSON.stringify(tagList || []);
                }

                await ArticleModel.update(updateData, { where: { id: articleId }, silent: true });
                //  如果传了classId，则更新文章归属大类
                if (Object.prototype.hasOwnProperty.call(req.body, 'classId') && classId) {
                    await ArticleControllers._updateArticleClass(articleId, oldClassId, classId, authorId);
                }
                //  如果设置了加锁，则更新密码
                if (visibleType === 2 && Object.prototype.hasOwnProperty.call(req.body, 'password') && password !== '') {
                    await ArticleControllers.updateArticleLock(articleId, authorId, password);
                }
                logger.info(`============用户ID:${authorId}修改文章:${articleId}============`);
                packageResponse('success', { successMessage: '修改文章成功' }, res);
            } catch (err) {
                logger.info(`============用户ID:${authorId}修改文章失败:${err}`);
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
                    `delete comment, reply, privacyarticle, article
                    from article
                    left join reply on article.id=reply.articleId
                    left join comment on article.id=comment.articleId
                    left join privacyarticle on article.id=privacyarticle.articleId
                    where article.id=${articleId}`
                );
                logger.info(`============用户删除文章:${articleId}============`);
                packageResponse('success', { successMessage: '删除文章成功' }, res);
            } catch (err) {
                logger.info(`============用户删除文章:${articleId}失败:${err}============`);
                packageResponse('error', { errorMessage: '删除文章失败: ' + err }, res);
            }
        } else {
            logger.info(`============用户删除文章:${articleId}失败:${err}============`);
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
                });
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
                await ArticleModel.update({ articleclassId: classId }, { where: { id: articleId }, silent: true });
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
                where: { id: classId, userId }
            });
            if (articleClassData) {
                if (articleClassData.articleList && JSON.parse(articleClassData.articleList).length !== 0) {
                    let list = JSON.parse(articleClassData.articleList);
                    list.push(articleId);
                    list = JSON.stringify(list);
                    await articleClassData.update({ articleList: list }, { where: { id: classId, userId } });
                } else {
                    let list = JSON.stringify([articleId]);
                    await articleClassData.update({ articleList: list }, { where: { id: classId, userId } });
                }

            }
        } catch (err) {
            throw new Error(err);
        }
    }

    // 更新文章归属大类内插入文章ID
    static async _updateArticleClass(articleId, oldClassId, classId, userId) {
        try {
            const articleClassData = await ArticleclassModel.findOne({
                where: { id: classId, userId }
            });
            const oldArticleClassData = await ArticleclassModel.findOne({
                where: { id: oldClassId, userId }
            });
            if (articleClassData) {
                if (articleClassData.articleList && JSON.parse(articleClassData.articleList).length !== 0) {
                    let list = JSON.parse(articleClassData.articleList);
                    list.push(articleId);
                    list = JSON.stringify(list);
                    await articleClassData.update({ articleList: list }, { where: { id: classId, userId } });
                } else {
                    let list = JSON.stringify([articleId]);
                    await articleClassData.update({ articleList: list }, { where: { id: classId, userId } });
                }
            }
            if (oldArticleClassData) {
                if (oldArticleClassData.articleList && JSON.parse(oldArticleClassData.articleList).length !== 0) {
                    let oldList = JSON.parse(oldArticleClassData.articleList);
                    let _oldList = oldList.filter((item) => item != articleId);
                    _oldList = JSON.stringify(_oldList);
                    console.log(_oldList);

                    await oldArticleClassData.update({ articleList: _oldList }, { where: { id: oldClassId, userId } });
                }
            }
        } catch (err) {
            throw new Error(err);
        }
    }

    //  设置文章锁
    static async setArticleLock(articleId, userId, password) {
        await PrivacyArticleModel.create(
            { articleId, userId, password },
        )
    }

    //  更新文章锁
    static async updateArticleLock(articleId, userId, password) {
        let lockData = await PrivacyArticleModel.findOne({ where: { articleId } });
        if (lockData) {
            if (password !== undefined && password !== '') {
                PrivacyArticleModel.update({ password }, { where: { articleId } });
            }
        } else {
            PrivacyArticleModel.create({ articleId, userId, password: password || '' });
        }
    }

    //  检验文章锁
    static async validateArticleLock(req, res, next) {
        const { error } = schemaValidateArticleLock.validate(req.body);
        if (!error) {
            const { articleId, password } = req.body;
            try {
                const result = await PrivacyArticleModel.findOne({ where: { articleId } });
                if (result.password === password) {
                    packageResponse('success', { successMessage: '解锁成功' }, res);
                } else {
                    packageResponse('error', { errorMessage: '密码错误' }, res);
                }
            } catch (err) {
                packageResponse('error', { errorMessage: err }, res);
            }
        } else {
            packageResponse('error', { errorMessage: error }, res);
        }
    }

    //  按照文章大类搜索文章
    static async searchArticleByClass(classId) {
        let data = await ArticleclassModel.findOne({ where: { id: classId } });
        if (data) {
            let articleList = JSON.parse(data.articleList);
            let result = await ArticleModel.findAll({ where: { id: articleList, visibleType: { $not: 3 } }, attributes: { exclude: ['content'] } });
            return result;
        }
    }

    //  查询猜你喜欢列表
    static async searchLikeArticle(req, res, next) {
        const { error } = schemaSearchLikeArticle.validate(req.body);
        if (!error) {
            const { articleId } = req.body;
            try {
                let articleData = await ArticleModel.findOne({ where: { id: articleId } });
                let { articleclassId, tagList } = articleData;
                let classArticleList = [];
                let tagArticleList = [];
                //  取文章大类中的前3项
                if (articleclassId) {
                    classArticleList = await ArticleControllers.searchArticleByClass(articleclassId);
                    classArticleList = classArticleList.slice(0, 3);
                }

                //  取tag相同的文章
                if (tagList) {
                    let _tagListList = JSON.parse(tagList);
                    let random = Math.floor(Math.random() * _tagListList.length);
                    let randomTag = _tagListList[random];
                    tagArticleList = await ArticleModel.findAll({ where: { $or: { tagList: { $like: `%${randomTag}%` } }, visibleType: { $not: 3 } }, attributes: { exclude: ['content'] } });
                    if (classArticleList.length < 3) {
                        tagArticleList = tagArticleList.slice(0, 6 - classArticleList.length);
                    } else {
                        tagArticleList = tagArticleList.slice(0, 3);
                    }
                }

                let resultTotalList = [...classArticleList, ...tagArticleList];

                // 去重相同文章
                function uniqueObjects(arr, key) {
                    let seen = new Set();
                    return arr.filter((item) => {
                        let hash = JSON.stringify(item[key]);
                        return seen.has(hash) ? false : seen.add(hash);
                    });
                }
                resultTotalList = uniqueObjects(resultTotalList, 'id').filter((item) => item.id != articleId);
                packageResponse('success', { data: resultTotalList }, res);
            } catch (err) {
                packageResponse('error', { errorMessage: err }, res);
            }
        } else {
            packageResponse('error', { errorMessage: error }, res);
        }
    }
}

module.exports = ArticleControllers;
