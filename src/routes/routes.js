const express = require('express');
const router = express.Router();
const multer = require('multer');
const storage = multer.memoryStorage();
const upload = multer({ storage: storage });

const coreController = require('../controllers/core.controller');
const csvEnrichmentController = require('../controllers/csvEnrichment.controller');

//Core
router.post('/core/error', coreController.sendErrorMessage);

//CSV Enrichment
router.post('/core/csv', upload.single('file'), csvEnrichmentController.enrichCsv);

module.exports = router;
