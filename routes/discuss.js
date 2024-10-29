const express = require('express');
const router = express.Router();
const { createComment, deleteComment, updateNotice, getNotice } = require('../controllers/discuss')

router.post('/createComment', createComment);
router.post('/deleteComment', deleteComment);
router.post('/updateNotice', updateNotice);
router.post('/getNotice', getNotice);

module.exports = router
