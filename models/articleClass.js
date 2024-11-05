const moment = require('moment')
// articleclass 表
module.exports = (sequelize, dataTypes) => {
  const articleclass = sequelize.define(
    'articleclass',
    {
      id: {
        type: dataTypes.INTEGER(11),
        primaryKey: true,
        autoIncrement: true
      },
      className: dataTypes.STRING(50),
      userId: dataTypes.INTEGER(11),
      articleList: dataTypes.STRING(255),
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

  articleclass.associate = models => {
    articleclass.hasMany(models.article);
  }

  return articleclass
}
