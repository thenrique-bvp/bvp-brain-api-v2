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

module.exports = {
	containsUrl,
	extractLinkedinUrl,
	generateRandomId
};
