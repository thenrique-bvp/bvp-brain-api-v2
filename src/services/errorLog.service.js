const axios = require('axios');

class ErrorLogService {
	/**
	 * Sends an error message to the error logging API endpoint
	 * @param {Object} errorData - The error data to send
	 * @param {string} errorData.service - The service name where the error occurred
	 * @param {string} errorData.method - The method name where the error occurred
	 * @param {string} errorData.error - The error, exception or stack trace
	 * @param {Object} errorData.details - Additional details like payload, user email, etc.
	 * @returns {Promise<Object>} - The API response
	 */
	async sendMessage(errorData) {
		try {
			const { service, method, error, details } = errorData;

			const message = `Service: ${service}\n\nMethod: ${method}\n\nError: ${error}\n\nDetails: ${JSON.stringify(
				details,
				null,
				2
			)}`;
			console.log('message', message);

			const response = await axios.post(
				'https://xt44qcnfdye4gdh3qb5wv4epsm0fmajc.lambda-url.us-east-2.on.aws/',
				{ message },
				{ headers: { 'Content-Type': 'application/json' } }
			);
			console.log('DATA', response.data);

			return response.data;
		} catch (err) {
			console.error('Error sending error message:', err);
			throw new Error('Failed to send error message');
		}
	}
}

module.exports = new ErrorLogService();
