const express = require('express');
const router = express.Router();
const multer = require('multer');
const storage = multer.memoryStorage();
const upload = multer({ storage: storage });

const coreController = require('../controllers/core.controller');
const csvEnrichmentController = require('../controllers/csvEnrichment.controller');
router.get('/core/test', coreController.test);

//CSV Enrichment
router.post('/v2/core/csv', upload.single('file'), csvEnrichmentController.enrichCsv);

module.exports = router;
