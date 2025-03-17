const csvEnrich = require('../services/csvEnrich.service');

class CsvEnrichmentController {
	async enrichCsv(req, res) {
		try {
			const email = req.query.email;
			const file = req.file;

			if (!email || !file) {
				return res.status(400).json({
					status: 'error',
					message: 'Email and file are required'
				});
			}

			const enrichedCsv = await csvEnrich.enrichCsv(email, file);

			res.status(200).json({
				status: 'success',
				message: 'CSV enriched successfully',
				enrichedCsv
			});
		} catch (err) {
			res.status(500).json({
				status: 'error',
				message: err.message
			});
		}
	}
}

module.exports = new CsvEnrichmentController();
