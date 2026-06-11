const moment = require('moment')
// codeRecord 表
module.exports = (sequelize, dataTypes) => {
    const CodeRecord = sequelize.define(
        'codeRecord',
        {
            id: { type: dataTypes.INTEGER(11), primaryKey: true, autoIncrement: true },
            content: { type: dataTypes.TEXT },
            codeId: dataTypes.INTEGER(11),
            authorId: dataTypes.INTEGER(11),
            isAnswer: { type: dataTypes.INTEGER(11), defaultValue: 0 }, // 是否为答案  0 不是；1 是
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
            }
        },
        {
            timestamps: true
        }
    )

    CodeRecord.associate = models => {
        // Code.hasMany(models.comment)
        // Code.hasMany(models.reply)
        // Code.belongsTo(models.articleclass, {
        //   foreignKey: 'articleclassId',
        //   targetKey: 'id',
        //   constraints: false
        // });
    }

    return CodeRecord
}
