class CoreController {
	test(req, res) {
		try {
			res.status(200).json({
				status: 'success',
				message: 'Welcome to the BVP Brain API'
			});
		} catch (err) {
			res.status(500).json({
				status: 'error',
				message: err.message
			});
		}
	}
}

module.exports = new CoreController();
