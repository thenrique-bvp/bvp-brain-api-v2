function containsUrl(query) {
	// Convert the query to lowercase for case-insensitive matching
	const queryLower = query.toLowerCase();

	// Check for presence of substrings
	return queryLower.includes('http') || queryLower.includes('www') || queryLower.includes('.com');
}

function extractLinkedinUrl(text) {
	// Regular expression pattern to match LinkedIn URLs
	const pattern = /https:\/\/linkedin\.com\/in\/[a-zA-Z0-9-]+/;

	// Using match to extract URL matching the pattern
	const match = text.match(pattern);

	// Return the first URL found, or null if no URLs were found
	return match ? match[0] : null;
}

function generateRandomId() {
	return crypto.randomBytes(5).toString('hex').toUpperCase();
}

async function retryWithBackoff(fn, maxRetries = 3, initialDelay = 300) {
	let retries = 0;
	while (true) {
		try {
			return await fn();
		} catch (error) {
			if (retries >= maxRetries) {
				throw error;
			}

			const delay = initialDelay * Math.pow(2, retries);
			console.log(`Retrying after ${delay}ms...`);
			await new Promise((resolve) => setTimeout(resolve, delay));
			retries++;
		}
	}
}

function synchronized(fn) {
	fn();
}
module.exports = {
	containsUrl,
	extractLinkedinUrl,
	generateRandomId,
	retryWithBackoff,
	synchronized
};
