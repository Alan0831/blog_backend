const moment = require('moment')
// friendcircle 表
module.exports = (sequelize, dataTypes) => {
    const FriendCircle = sequelize.define(
        'friendcircle',
        {
            id: {
                type: dataTypes.INTEGER(11),
                primaryKey: true,
                autoIncrement: true
            },
            userId: dataTypes.INTEGER(11), // 发布人 id
            visibleType: {
                type: dataTypes.TINYINT,
                defaultValue: 1,
                comment: '是否上锁:1 - 所有人可见, 2 - 加锁, 3 - 仅自己可见'
            },
            likeCount: {
                type: dataTypes.INTEGER(11),
                defaultValue: 0
            },
            content: { type: dataTypes.TEXT },
            // articleId: dataTypes.INTEGER(11), // 所属文章 id
            // videoId: dataTypes.INTEGER(11), // 所属视频 id
            type: dataTypes.INTEGER(11), // 1 文章；2 视频；3 评论
            createdAt: {
                type: dataTypes.DATE,
                defaultValue: dataTypes.NOW,
                get() {
                    return moment(this.getDataValue('createdAt')).format('YYYY-MM-DD HH:mm:ss')
                }
            },
            updatedAt: {
                type: dataTypes.DATE,
                defaultValue: dataTypes.NOW,
                get() {
                    return moment(this.getDataValue('updatedAt')).format('YYYY-MM-DD HH:mm:ss')
                }
            },
        },
        {
            timestamps: true
        }
    )

    FriendCircle.associate = models => {
        FriendCircle.belongsTo(models.article, {
            as: 'article',
            foreignKey: 'articleId',
            targetKey: 'id',
            constraints: false
        });
        FriendCircle.belongsTo(models.video, {
            as: 'video',
            foreignKey: 'videoId',
            targetKey: 'id',
            constraints: false
        });
    }

    return FriendCircle
}
