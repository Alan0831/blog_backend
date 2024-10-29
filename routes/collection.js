const express = require('express');
const router = express.Router();
const { addCollection, searchCollection, deleteCollection } = require('../controllers/collection')

router.post('/addCollection', addCollection);
router.post('/searchCollection', searchCollection);
router.post('/deleteCollection', deleteCollection);

module.exports = router
