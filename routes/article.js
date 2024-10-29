const express = require('express');
const router = express.Router();
const { getArticleList, findArticleById, createArticle, editArticle, deleteArticle, getRecommendArticleList } = require('../controllers/article')

router.post('/getArticleList', getArticleList);
router.post('/findArticleById', findArticleById);
router.post('/createArticle', createArticle);
router.post('/editArticle', editArticle);
router.post('/deleteArticle', deleteArticle);
router.post('/getRecommendArticleList', getRecommendArticleList);

module.exports = router
