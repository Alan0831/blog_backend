const express = require('express');
const router = express.Router();
const { addCollection, searchCollection, deleteCollection, addVideoCollection, deleteVideoCollection } = require('../controllers/collection')

router.post('/addCollection', addCollection);
router.post('/searchCollection', searchCollection);
router.post('/deleteCollection', deleteCollection);
router.post('/addVideoCollection', addVideoCollection);
router.post('/deleteVideoCollection', deleteVideoCollection);

module.exports = router
