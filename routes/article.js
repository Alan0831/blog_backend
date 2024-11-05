const express = require('express');
const router = express.Router();
const { getArticleList, findArticleById, createArticle, editArticle, deleteArticle, getRecommendArticleList,
    createArticleClassName, searchArticleClassName, setArticleClass, validateArticleLock
 } = require('../controllers/article')

router.post('/getArticleList', getArticleList);
router.post('/findArticleById', findArticleById);
router.post('/createArticle', createArticle);
router.post('/editArticle', editArticle);
router.post('/deleteArticle', deleteArticle);
router.post('/getRecommendArticleList', getRecommendArticleList);
router.post('/createArticleClassName', createArticleClassName);
router.post('/searchArticleClassName', searchArticleClassName);
router.post('/setArticleClass', setArticleClass);
router.post('/validateArticleLock', validateArticleLock);

module.exports = router
