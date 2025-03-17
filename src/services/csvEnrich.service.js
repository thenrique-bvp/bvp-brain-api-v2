const axios = require('axios');
const csv = require('csv-parser');
const { Readable } = require('stream');
const { stringify } = require('csv-stringify/sync');
const { URL } = require('url');
const crypto = require('crypto');
const { sendEmail } = require('./email.service');

const endpoint = 'https://brain.bessemer.io/api/v1/website';
const headers = { 'Content-Type': 'application/json' };
const AFFINITY_API_KEY = '5Vn1lVdoBUBqVA8D73ScuqTqqwntGRFs3bDcRZ5mJiY';

class CsvEnrichService {
	async searchOrganizations(
		term = null,
		withInteractionDates = false,
		withInteractionPersons = false,
		minLastEmailDate = null,
		maxLastEmailDate = null,
		pageSize = 500
	) {
		const baseUrl = 'https://api.affinity.co/organizations';
		const auth = { username: '', password: AFFINITY_API_KEY };

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
		const docs = responseJson?.response?.docs || [];

		if (docs.length > 0) {
			const fieldValue = docs[0][field] || [];

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
		console.log('Re-check SOLR', domain);
		const solrUrl = 'http://52.15.85.181:8983/solr/companies_specter_ID/select';

		// Define query parameters
		const queryParams = {
			'q.op': 'OR',
			q: `Website:"${domain}"`,
			sort: '_version_ DESC'
		};

		return this.retryWithBackoff(async () => {
			const response = await axios.get(solrUrl, {
				params: queryParams,
				timeout: 5000 // Add timeout to prevent hanging requests
			});
			return response.data;
		});
	}

	containsUrl(query) {
		const queryLower = query.toLowerCase();

		return queryLower.includes('http') || queryLower.includes('www') || queryLower.includes('.com');
	}

	extractLinkedinUrl(text) {
		const pattern = /https:\/\/linkedin\.com\/in\/[a-zA-Z0-9-]+/;

		const matches = text.match(pattern);

		return matches ? matches[0] : null;
	}

	generateRandomId() {
		return crypto.randomBytes(5).toString('hex').toUpperCase();
	}

	async callBatchEndpoint(companiesData) {
		const url = 'https://brain.bessemer.io/api/v1/core/batch';
		const headers = { 'Content-Type': 'application/json' };

		return this.retryWithBackoff(
			async () => {
				const response = await axios.post(url, companiesData, {
					headers,
					timeout: 8000 // Add timeout to prevent hanging requests
				});
				return response.data;
			},
			3,
			500
		);
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

	synchronized(fn) {
		fn();
	}

	async retryWithBackoff(fn, maxRetries = 3, initialDelay = 300) {
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

	async processCSV(userEmail, file) {
		try {
			console.time('csv-processing');

			const csvData = file.buffer.toString('utf-8');
			const records = [];

			await new Promise((resolve, reject) => {
				const stream = Readable.from(csvData, { highWaterMark: 64 * 1024 }); // 64KB chunks
				stream
					.pipe(
						csv({
							skipLines: 0,
							maxRows: Infinity,
							strict: true
						})
					)
					.on('data', (row) => records.push(row))
					.on('end', resolve)
					.on('error', reject);
			});

			console.timeLog('csv-processing', 'CSV parsing completed');

			const companyUrls = records.map((row) => row.company_url);
			const parsedUrls = companyUrls.map(this.cleanAndParseUrl);

			console.timeLog('csv-processing', 'URL parsing completed');

			const solrCache = new Map();
			const affinityCache = new Map();

			const batchSize = 80; //Podemos aumentar para quanto quisermos
			const listOfReturns = [];

			// Dividindo em batches para não sobrecarregar a API
			const batches = [];
			for (let i = 0; i < parsedUrls.length; i += batchSize) {
				batches.push(parsedUrls.slice(i, i + batchSize));
			}

			const concurrencyLimit = 3;
			let activeBatches = 0;

			for (let i = 0; i < batches.length; i += concurrencyLimit) {
				const currentBatches = batches.slice(i, i + concurrencyLimit);

				// Processar em paralelo
				await Promise.all(
					currentBatches.map(async (batchUrls) => {
						activeBatches++;
						console.log(`Processing batch ${activeBatches}/${batches.length}`);

						const payload = JSON.stringify({ websites: batchUrls });

						const response = await this.retryWithBackoff(async () => {
							return await axios.post(endpoint, payload, {
								headers,
								timeout: 15000
							});
						});

						if (response.status !== 200) {
							throw new Error(`Failed to fetch data from core endpoint: ${response.statusText}`);
						}

						const affinityMetadata = response.data;
						const payloadForCore = { companies: [] };

						// Preparar dados para API co
						batchUrls.forEach((url) => {
							const companyName = affinityMetadata[url]?.[0]?.Name?.[0] || url;
							payloadForCore.companies.push({
								company_url: url,
								company_name: companyName
							});
						});

						const allData = await this.callBatchEndpoint(payloadForCore);

						// Processar URLs em paralelo, mas com limitação para não sobrecarregar APIs
						const chunkSize = 20; // Processar 20 por vez
						for (let j = 0; j < batchUrls.length; j += chunkSize) {
							const chunk = batchUrls.slice(j, j + chunkSize);

							await Promise.all(
								chunk.map(async (url) => {
									try {
										const companyData = await this.processCompanyData(
											url,
											companyUrls,
											affinityMetadata,
											allData,
											solrCache,
											affinityCache
										);

										// Evitar que o array seja alterado enquanto estamos iterando sobre ele
										this.synchronized(() => {
											listOfReturns.push(companyData);
										});
									} catch (error) {
										console.error(`Error processing ${url}:`, error);
										// Adicionar entrada com erro para não quebrar o processo
										listOfReturns.push({
											ID: `${this.generateRandomId()}-${this.generateRandomId()}`,
											'Company Name': url,
											'Company Website': url,
											Error: error.message,
											// Adicionar campos default
											'Last Email Date': 'Error',
											'Last Meeting Date': 'Error'
											// ...outros campos com valores default
										});
									}
								})
							);
						}

						activeBatches--;
						console.log(`Completed batch. ${activeBatches} active batches remaining.`);
					})
				);
			}

			console.timeLog('csv-processing', 'Data enrichment completed');

			const csvOutput = stringify(listOfReturns, {
				header: true,
				quoted: true,
				quoted_empty: true
			});

			if (userEmail) {
				await sendEmail(userEmail, csvOutput);
			}

			console.timeEnd('csv-processing');
			return csvOutput;
		} catch (error) {
			console.error('Error processing CSV:', error);
			throw error;
		}
	}

	async processCompanyData(url, companyUrls, affinityMetadata, allData, solrCache, affinityCache) {
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
			// Extract all Affinity data in one pass
			this.extractAffinityData(metadata, {
				founder,
				totalFunding,
				lastFunding,
				fundingDate,
				headcount,
				location,
				employeeGrowth,
				companyLinkedin,
				affinityId,
				description,
				lastEmail,
				lastMeeting
			});
		}

		// Se last email is not available, try to get it from Solr - usando cache
		if (lastEmail === 'N/A' || lastEmail === '' || lastEmail === null) {
			let specterFound;

			// Check cache first
			if (solrCache.has(url)) {
				specterFound = solrCache.get(url);
			} else {
				specterFound = await this.querySolrByDomain(url);
				// Store in cache
				solrCache.set(url, specterFound);
			}

			// Processar todos os campos em um único ciclo
			const fields = {
				Last_Email: (value) => {
					lastEmail = value;
				},
				Year_Founded: (value) => {
					dateFunded = value;
				},
				Number_of_Employees: (value) => {
					headcount = value;
				},
				Employees__Growth_YoY____: (value) => {
					employeeGrowth = value;
				},
				LinkedIn_Profile__Founders_CEOs_: (value) => {
					founder = value;
				},
				LinkedIn_URL: (value) => {
					companyLinkedin = value;
				},
				Total_Funding_Amount__USD_: (value) => {
					totalFunding = value;
				},
				Last_Funding_Date: (value) => {
					fundingDate = value;
				},
				Last_Funding_Amount__USD_: (value) => {
					lastFunding = value;
				},
				Location__Country_: (value) => {
					location = value;
				}
			};

			this.extractMultipleFields(specterFound, fields);
		}

		// Search in Affinity API - com cache
		let affinity;
		try {
			if (affinityCache.has(url)) {
				affinity = affinityCache.get(url);
			} else {
				affinity = await this.searchOrganizations(
					url,
					true,
					true,
					'2001-01-01T00:00:00',
					'2034-01-12T23:59:59'
				);
				affinityCache.set(url, affinity);
			}

			if (affinity && affinity.length > 0) {
				lastEmail = affinity[0].interaction_dates.last_email_date;
				lastMeeting = affinity[0].interaction_dates.last_event_date;
				affinityId = affinity[0].id;
			}
		} catch (error) {
			console.error(`Error searching Affinity for ${url}:`, error);
		}

		return {
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
		};
	}

	cleanAndParseUrl(url) {
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
	}

	extractMultipleFields(responseJson, fieldsMap) {
		const docs = responseJson?.response?.docs || [];

		if (docs.length > 0) {
			Object.entries(fieldsMap).forEach(([fieldName, callback]) => {
				const fieldValue = docs[0][fieldName] || [];
				if (fieldValue.length > 0) {
					callback(fieldValue[0]);
				}
			});
		}
	}

	/**
	 * Extract all Affinity data in one pass
	 */
	extractAffinityData(metadata, dataObj) {
		if ('LinkedIn_Profile__Founders_CEOs_' in metadata) {
			dataObj.founder =
				this.extractLinkedinUrl(metadata['LinkedIn_Profile__Founders_CEOs_'][0]) || dataObj.founder;
		}

		if (dataObj.totalFunding === 'N/A' && 'Total_Funding_Amount__USD_' in metadata) {
			dataObj.totalFunding = metadata['Total_Funding_Amount__USD_'][0];
		}

		if (dataObj.lastFunding === 'N/A' && 'Last_Funding_Amount__USD_' in metadata) {
			dataObj.lastFunding = metadata['Last_Funding_Amount__USD_'][0];
		}

		if (dataObj.fundingDate === 'N/A' && 'Last_Funding_Date' in metadata) {
			dataObj.fundingDate = metadata['Last_Funding_Date'][0];
		}

		if ('Number_of_Employees' in metadata) {
			dataObj.headcount = metadata['Number_of_Employees'][0];
		}

		if ('Location__Country_' in metadata) {
			dataObj.location = metadata['Location__Country_'][0];
		}

		if ('Employees__Growth_YoY____' in metadata) {
			dataObj.employeeGrowth = metadata['Employees__Growth_YoY____'][0].toString();
		}

		if (
			dataObj.employeeGrowth === 'N/A' &&
			'Number_of_Employees' in metadata &&
			'Employees__12_Months_Ago' in metadata
		) {
			const currentEmployees = parseInt(metadata['Number_of_Employees'][0]);
			const employees12MonthsAgo = parseInt(metadata['Employees__12_Months_Ago'][0]);

			if (employees12MonthsAgo !== 0) {
				const growthRate = ((currentEmployees - employees12MonthsAgo) / employees12MonthsAgo) * 100;
				dataObj.employeeGrowth = growthRate.toFixed(2);
			}
		}

		if (dataObj.companyLinkedin === 'N/A' && 'LinkedIn_URL' in metadata) {
			dataObj.companyLinkedin = metadata['LinkedIn_URL'][0];
		}

		if ('Organization_Id' in metadata) {
			dataObj.affinityId = metadata['Organization_Id'][0];
		}

		if (dataObj.description === 'N/A' && 'Description' in metadata) {
			dataObj.description = metadata['Description'][0];
		}

		// Get last email and meeting data
		dataObj.lastEmail = metadata?.Last_Email?.[0] || 'N/A';
		dataObj.lastMeeting = metadata?.Last_Meeting?.[0] || 'N/A';
	}

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
