const axios = require('axios');
const csv = require('csv-parser');
const { Readable } = require('stream');
const { stringify } = require('csv-stringify/sync');
const { URL } = require('url');
const crypto = require('crypto');
const base64 = require('base-64');

// Configuration
const endpoint = 'https://brain.bessemer.io/api/v1/website';
const headers = { 'Content-Type': 'application/json' };
const AFFINITY_API_KEY = '5Vn1lVdoBUBqVA8D73ScuqTqqwntGRFs3bDcRZ5mJiY';

class CsvEnrichService {
	/**
	 * Search organizations in Affinity
	 */
	async searchOrganizations(
		term = null,
		withInteractionDates = false,
		withInteractionPersons = false,
		minLastEmailDate = null,
		maxLastEmailDate = null,
		pageSize = 500
	) {
		const baseUrl = 'https://api.affinity.co/organizations';
		const auth = { username: '', password: AFFINITY_API_KEY }; // API key as password, no username

		let params = {
			term,
			with_interaction_dates: withInteractionDates,
			with_interaction_persons: withInteractionPersons,
			page_size: pageSize,
			min_last_email_date: minLastEmailDate,
			max_last_email_date: maxLastEmailDate
		};

		// Remove null parameters
		Object.keys(params).forEach((key) => params[key] === null && delete params[key]);

		const results = [];
		let nextPageToken = null;

		try {
			do {
				if (nextPageToken) {
					params.page_token = nextPageToken;
				}

				const response = await axios.get(baseUrl, {
					auth,
					params
				});

				const data = response.data;
				results.push(...(data.organizations || []));

				nextPageToken = data.next_page_token;
			} while (nextPageToken);

			return results;
		} catch (error) {
			throw new Error(`Failed to fetch organizations: ${error.message}`);
		}
	}

	/**
	 * Extract field from Solr response
	 */
	extractField(responseJson, field) {
		// Extract the 'docs' list from the response
		const docs = responseJson?.response?.docs || [];

		// Check if 'docs' list is not empty
		if (docs.length > 0) {
			// Extract the field from the first document
			const fieldValue = docs[0][field] || [];

			// Return the first value if the list is not empty
			if (fieldValue.length > 0) {
				return fieldValue[0];
			}
		}

		// Return default value if not found
		return 'N/A';
	}

	/**
	 * Query Solr by domain
	 */
	async querySolrByDomain(domain) {
		console.log('Re-check SOLR');
		const solrUrl = 'http://52.15.85.181:8983/solr/companies_specter_ID/select';

		// Define query parameters
		const queryParams = {
			'q.op': 'OR',
			q: `Website:"${domain}"`,
			sort: '_version_ DESC'
		};

		try {
			// Make a GET request to the Solr server with the specified domain
			const response = await axios.get(solrUrl, { params: queryParams });
			return response.data;
		} catch (error) {
			console.error(`An error occurred: ${error}`);
			return null;
		}
	}

	/**
	 * Check if string contains URL
	 */
	containsUrl(query) {
		// Convert the query to lowercase for case-insensitive matching
		const queryLower = query.toLowerCase();

		// Check for presence of substrings
		return queryLower.includes('http') || queryLower.includes('www') || queryLower.includes('.com');
	}

	/**
	 * Extract LinkedIn URL from text
	 */
	extractLinkedinUrl(text) {
		// Regular expression pattern to match LinkedIn URLs
		const pattern = /https:\/\/linkedin\.com\/in\/[a-zA-Z0-9-]+/;

		// Using match to extract all URLs matching the pattern
		const matches = text.match(pattern);

		// Return the first URL found, or null if no URLs were found
		return matches ? matches[0] : null;
	}

	/**
	 * Generate random ID
	 */
	generateRandomId() {
		return crypto.randomBytes(5).toString('hex').toUpperCase();
	}

	/**
	 * Call batch endpoint
	 */
	async callBatchEndpoint(companiesData) {
		const url = 'https://brain.bessemer.io/api/v1/core/batch';
		const headers = { 'Content-Type': 'application/json' };

		try {
			const response = await axios.post(url, companiesData, { headers });
			return response.data;
		} catch (error) {
			return { error: `Error occurred: ${error.message}` };
		}
	}

	/**
	 * Get data for URL
	 */
	getDataForUrl(url, dataList) {
		for (const item of dataList) {
			if (item.url === url) {
				if (item.data && item.data.length > 0) {
					return item.data[0];
				} else {
					console.log(`No data found for ${url}`);
					return null;
				}
			}
		}
		console.log(`URL not found in the list: ${url}`);
		return null;
	}

	/**
	 * Process CSV file and enrich data
	 */
	async processCSV(userEmail, file) {
		try {
			// Parse CSV from buffer
			const csvData = file.toString('utf-8');
			const records = [];

			// Parse CSV data
			await new Promise((resolve, reject) => {
				const stream = Readable.from(csvData);
				stream
					.pipe(csv())
					.on('data', (row) => records.push(row))
					.on('end', resolve)
					.on('error', reject);
			});

			// Extract company URLs
			const companyUrls = records.map((row) => row.company_url);

			// Parse and clean URLs
			const parsedUrls = companyUrls.map((url) => {
				let parsedUrl = url.replace(/https?:\/\//, '').replace('www.', '');
				parsedUrl = parsedUrl.replace(/[\[\]'"]/g, '');

				try {
					const urlObj = new URL(`//${parsedUrl}`);
					let parsedDomain = urlObj.hostname;
					if (parsedDomain.startsWith('ftp.')) {
						parsedDomain = `${urlObj.protocol}//${parsedDomain}`;
					}
					return parsedDomain;
				} catch (e) {
					console.error(`Invalid URL: ${parsedUrl}`, e);
					return parsedUrl;
				}
			});

			// Process the URLs in batches
			const batchSize = 40;
			const listOfReturns = [];

			for (let i = 0; i < parsedUrls.length; i += batchSize) {
				const batchUrls = parsedUrls.slice(i, i + batchSize);
				const payloadForCore = { companies: [] };

				// Prepare JSON payload for core endpoint
				const payload = JSON.stringify({ websites: batchUrls });
				const response = await axios.post(endpoint, payload, { headers });

				if (response.status !== 200) {
					throw new Error(`Failed to fetch data from core endpoint: ${response.statusText}`);
				}

				const affinityMetadata = response.data;

				// Prepare data for core API
				for (const url of batchUrls) {
					if (affinityMetadata[url] && affinityMetadata[url].length > 0) {
						payloadForCore.companies.push({
							company_url: url,
							company_name: affinityMetadata[url][0]?.Name?.[0] || url
						});
					} else {
						payloadForCore.companies.push({
							company_url: url,
							company_name: url
						});
					}
				}

				// Call batch endpoint
				const allData = await this.callBatchEndpoint(payloadForCore);

				// Process each URL in the batch
				for (const url of batchUrls) {
					let sfAccount = 'N/A';
					const companyName = affinityMetadata[url]?.[0]?.Name?.[0] || url;
					let sfStringData = 'N/A';
					let specterData = {};

					// Process Salesforce data
					if (allData?.salesforce?.websites && url in allData.salesforce.websites) {
						const sfWebsites = allData.salesforce.websites[url] || [];
						if (sfWebsites.length > 0) {
							const sfUrl = sfWebsites[0].attributes?.url || '';
							sfAccount = `https://bvp.lightning.force.com/lightning/r/Account${sfUrl.substring(
								sfUrl.lastIndexOf('/')
							)}/view`;
							sfStringData = sfWebsites[0].Owner?.Name || 'N/A';
						}
					}

					if (allData?.salesforce?.names && companyName in allData.salesforce.names) {
						const sfNames = allData.salesforce.names[companyName] || [];
						if (sfNames.length > 0) {
							const sfUrl = sfNames[0].attributes?.url || '';
							sfAccount = `https://bvp.lightning.force.com/lightning/r/Account${sfUrl.substring(
								sfUrl.lastIndexOf('/')
							)}/view`;
							sfStringData = sfNames[0].Owner?.Name || 'N/A';
						}
					}

					// Find specter data
					const findSpecterData = (allData, companyName) =>
						(allData.specter || []).filter((specter) => specter.Company_Name?.[0] === companyName);

					specterData = findSpecterData(allData, companyName);

					// Default values
					let dateFunded = 'N/A';
					let companyLinkedin = 'N/A';
					let headcount = 'N/A';
					let description = 'N/A';
					let location = 'N/A';
					let founder = 'N/A';
					let totalFunding = 'N/A';
					let lastFunding = 'N/A';
					let fundingDate = 'N/A';
					let employeeGrowth = 'N/A';
					let affinityId = 'N/A';
					let lastMeeting = 'N/A';
					let lastEmail = 'N/A';

					// Process Specter data if available
					if (specterData.length > 0) {
						dateFunded = specterData[0].Founded_Date?.[0] || 'N/A';
						companyLinkedin = specterData[0]['LinkedIn_-_URL']?.[0] || 'N/A';
						headcount = specterData[0].Employee_Count?.[0] || 'N/A';
						description = specterData[0].Description?.[0] || 'N/A';
						location = specterData[0].HQ_Region?.[0] || 'N/A';
						founder = specterData[0].Founders?.[0] || 'N/A';
						employeeGrowth = specterData[0]['Employees_-_6_Months_Growth']?.[0]?.toString() || '0';

						if ('Total_Funding_Amount__in_USD_' in specterData[0]) {
							totalFunding = specterData[0]['Total_Funding_Amount__in_USD_'][0];
						}

						if ('Last_Funding_Amount__in_USD_' in specterData[0]) {
							lastFunding = specterData[0]['Last_Funding_Amount__in_USD_'][0];
						}

						if ('Last_Funding_Date' in specterData[0]) {
							fundingDate = specterData[0]['Last_Funding_Date'][0];
						}
					}

					// Process Affinity metadata
					if (affinityMetadata[url]?.length > 0) {
						const metadata = affinityMetadata[url][0];

						if ('LinkedIn_Profile__Founders_CEOs_' in metadata) {
							founder =
								this.extractLinkedinUrl(metadata['LinkedIn_Profile__Founders_CEOs_'][0]) || founder;
						}

						if (totalFunding === 'N/A' && 'Total_Funding_Amount__USD_' in metadata) {
							totalFunding = metadata['Total_Funding_Amount__USD_'][0];
						}

						if (lastFunding === 'N/A' && 'Last_Funding_Amount__USD_' in metadata) {
							lastFunding = metadata['Last_Funding_Amount__USD_'][0];
						}

						if (fundingDate === 'N/A' && 'Last_Funding_Date' in metadata) {
							fundingDate = metadata['Last_Funding_Date'][0];
						}

						if ('Number_of_Employees' in metadata) {
							headcount = metadata['Number_of_Employees'][0];
						}

						if ('Location__Country_' in metadata) {
							location = metadata['Location__Country_'][0];
						}

						if ('Employees__Growth_YoY____' in metadata) {
							employeeGrowth = metadata['Employees__Growth_YoY____'][0].toString();
						}

						if (
							employeeGrowth === 'N/A' &&
							'Number_of_Employees' in metadata &&
							'Employees__12_Months_Ago' in metadata
						) {
							const currentEmployees = parseInt(metadata['Number_of_Employees'][0]);
							const employees12MonthsAgo = parseInt(metadata['Employees__12_Months_Ago'][0]);

							if (employees12MonthsAgo !== 0) {
								const growthRate =
									((currentEmployees - employees12MonthsAgo) / employees12MonthsAgo) * 100;
								employeeGrowth = growthRate.toFixed(2);
							}
						}

						if (companyLinkedin === 'N/A' && 'LinkedIn_URL' in metadata) {
							companyLinkedin = metadata['LinkedIn_URL'][0];
						}

						if ('Organization_Id' in metadata) {
							affinityId = metadata['Organization_Id'][0];
						}

						if (description === 'N/A' && 'Description' in metadata) {
							description = metadata['Description'][0];
						}

						// Get last email and meeting data
						lastEmail = metadata?.Last_Email?.[0] || 'N/A';
						lastMeeting = metadata?.Last_Meeting?.[0] || 'N/A';
					}

					// If last email is not available, try to get it from Solr
					if (lastEmail === 'N/A' || lastEmail === '' || lastEmail === null) {
						const specterFound = await this.querySolrByDomain(url);

						lastEmail = this.extractField(specterFound, 'Last_Email');
						dateFunded = this.extractField(specterFound, 'Year_Founded');
						headcount = this.extractField(specterFound, 'Number_of_Employees');
						employeeGrowth = this.extractField(specterFound, 'Employees__Growth_YoY____');
						founder = this.extractField(specterFound, 'LinkedIn_Profile__Founders_CEOs_');
						companyLinkedin = this.extractField(specterFound, 'LinkedIn_URL');
						totalFunding = this.extractField(specterFound, 'Total_Funding_Amount__USD_');
						fundingDate = this.extractField(specterFound, 'Last_Funding_Date');
						lastFunding = this.extractField(specterFound, 'Last_Funding_Amount__USD_');
						location = this.extractField(specterFound, 'Location__Country_');
					}

					// Salesforce lookup (this would need to be implemented)
					// if (sfAccount === "N/A" || !sfAccount) {
					//   const salesforceData = await this.getSalesforceData(companyName, url);
					//   // Process salesforce data
					// }

					// Search in Affinity API
					try {
						const affinity = await this.searchOrganizations(
							url,
							true,
							true,
							'2001-01-01T00:00:00',
							'2034-01-12T23:59:59'
						);

						if (affinity && affinity.length > 0) {
							lastEmail = affinity[0].interaction_dates.last_email_date;
							lastMeeting = affinity[0].interaction_dates.last_event_date;
							affinityId = affinity[0].id;
						}
					} catch (error) {
						console.error(`Error searching Affinity for ${url}:`, error);
					}

					// Add company data to results
					listOfReturns.push({
						ID: `${this.generateRandomId()}-${this.generateRandomId()}`,
						date_added: '',
						'Company Name': companyName,
						'Company Website': url,
						'Last Email Date': lastEmail,
						'Last Meeting Date': lastMeeting,
						'Link to Salesforce Entry': sfAccount,
						'Salesforce Return String': sfStringData,
						'Link to Affinity Entry':
							affinityId !== 'N/A' ? `https://bvp.affinity.co/companies/${affinityId}` : affinityId,
						'Year Founded': dateFunded,
						'Company Linkedin': companyLinkedin,
						'Number of Employees': headcount,
						Description: description,
						Country: location,
						"Founders, CEO's Linkedin": founder,
						'Total Funding': totalFunding,
						'Last Funding': lastFunding,
						'Last Funding Date': fundingDate,
						'Employee Growth Rate': employeeGrowth
					});
				}
			}

			// Convert the results to CSV
			const csvOutput = stringify(listOfReturns, { header: true });

			// Send email if user email is provided
			if (userEmail) {
				await this.sendEmail(userEmail, csvOutput);
			}

			return csvOutput;
		} catch (error) {
			console.error('Error processing CSV:', error);
			throw error;
		}
	}

	/**
	 * Main entry point for the service
	 */
	async enrichCsv(userEmail, file) {
		try {
			return await this.processCSV(userEmail, file);
		} catch (error) {
			console.error('Error in enrichCsv:', error);
			throw error;
		}
	}
}

module.exports = new CsvEnrichService();
