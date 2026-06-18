function hasValue(value) {
    return value !== undefined && value !== null && String(value).trim() !== '';
}

function appendAndWhere(where, condition) {
    if (!where.$and) {
        where.$and = [];
    }
    where.$and.push(condition);
}

function getLikeValue(value) {
    return `%${String(value).trim()}%`;
}

// 统一处理文章/视频列表筛选条件，保证 rows 和 count 使用同一套 where。
function appendContentListFilter(where, filters = {}, options = {}) {
    const { fixedAuthor = '', allowPrivate = false } = options;
    const { author, title, visibleType, createdAtStart, createdAtEnd } = filters;

    if (hasValue(fixedAuthor)) {
        where.author = String(fixedAuthor).trim();
    }

    if (hasValue(author)) {
        const authorCondition = { author: { $like: getLikeValue(author) } };
        // userId 查询时必须先锁定当前用户，再叠加作者名模糊筛选。
        if (hasValue(fixedAuthor)) {
            appendAndWhere(where, authorCondition);
        } else {
            where.author = authorCondition.author;
        }
    }

    if (hasValue(title)) {
        where.title = { $like: getLikeValue(title) };
    }

    if (hasValue(visibleType)) {
        const type = parseInt(visibleType, 10);
        if (!Number.isNaN(type)) {
            // 非个人列表不能通过 visibleType=3 查出仅自己可见的内容。
            where.visibleType = allowPrivate || type !== 3 ? type : -1;
        }
    } else if (!allowPrivate) {
        where.visibleType = { $not: 3 };
    }

    const createdAt = {};
    if (hasValue(createdAtStart)) {
        createdAt.$gte = String(createdAtStart).trim();
    }
    if (hasValue(createdAtEnd)) {
        createdAt.$lte = String(createdAtEnd).trim();
    }
    if (Object.keys(createdAt).length > 0) {
        where.createdAt = createdAt;
    }

    return where;
}

// keyword 保留原有“标题或正文”搜索；新增 title 入参则作为独立筛选条件叠加。
function appendKeywordFilter(where, keyword, fields = ['title', 'content']) {
    if (!hasValue(keyword)) return where;

    where.$or = fields.reduce((result, field) => {
        result[field] = { $like: getLikeValue(keyword) };
        return result;
    }, {});

    return where;
}

function appendArticleClassFilter(where, articleclassId) {
    if (hasValue(articleclassId)) {
        where.articleclassId = articleclassId;
    }
    return where;
}

module.exports = {
    appendArticleClassFilter,
    appendContentListFilter,
    appendKeywordFilter,
};
