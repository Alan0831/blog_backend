const moment = require('moment')
// tag 表
module.exports = (sequelize, dataTypes) => {
    const tag = sequelize.define(
        'tag',
        {
            id: {
                type: dataTypes.INTEGER(11),
                primaryKey: true,
                autoIncrement: true
            },
            tagName: dataTypes.STRING(50),
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

    return tag
}
