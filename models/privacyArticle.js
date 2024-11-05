const moment = require('moment')
// privacyarticle 表
module.exports = (sequelize, dataTypes) => {
  const privacyarticle = sequelize.define(
    'privacyarticle',
    {
      id: {
        type: dataTypes.INTEGER(11),
        primaryKey: true,
        autoIncrement: true
      },
      password: {
        type: dataTypes.STRING,
        allowNull: false
      },
      articleId: dataTypes.INTEGER(11), // 所属文章 id
      userId: dataTypes.INTEGER(11), // 作者 id
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

  return privacyarticle
}
