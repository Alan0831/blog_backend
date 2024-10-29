const moment = require('moment')
// notification 表
module.exports = (sequelize, dataTypes) => {
    const Notification = sequelize.define(
        'notification',
        {
            id: {
                type: dataTypes.INTEGER(11),
                primaryKey: true,
                autoIncrement: true
            },
            from: dataTypes.INTEGER(11), // 消息来源ID
            fromName: dataTypes.STRING(50),
            // to: dataTypes.INTEGER(11), // 消息目的ID
            toName: dataTypes.STRING(50),
            content: { type: dataTypes.TEXT },
            articleId: dataTypes.INTEGER(11), // 所属文章 id
            read: { type: dataTypes.INTEGER(11), defaultValue: 0 }, // 是否已读  0 未读；1 已读
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

    return Notification
}
