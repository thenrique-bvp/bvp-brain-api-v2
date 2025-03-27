const express = require('express');
const router = express.Router();
const multer = require('multer');
const storage = multer.memoryStorage();
const upload = multer({ storage: storage });

const coreController = require('../controllers/core.controller');
const csvEnrichmentController = require('../controllers/csvEnrichment.controller');
const salesforceController = require('../controllers/salesforce.controller');

//Core
router.post('/core/error', coreController.sendErrorMessage);

//Salesforce
router.get('/salesforce/check_company', salesforceController.checkCompany);

//CSV Enrichment
router.post('/core/csv', upload.single('file'), csvEnrichmentController.enrichCsv);

module.exports = router;
