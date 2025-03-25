const axios = require('axios');
const csv = require('csv-parser');
const { Readable } = require('stream');
const { stringify } = require('csv-stringify/sync');
const { URL } = require('url');
const crypto = require('crypto');
const { sendEmail } = require('./email.service');
const { retryWithBackoff, synchronized } = require('../utils');
const { querySolrByDomain } = require('./solr.service');
const { salesforceApi } = require('./salesforce.service');
const endpoint = 'https://brain.bessemer.io/api/v1/website';
const headers = { 'Content-Type': 'application/json' };
const AFFINITY_API_KEY = process.env.AFFINITY_API_KEY;
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
			console.error(`Failed to fetch organizations for ${term}: ${error.message}`);
			throw error;
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
		console.log('companiesData', companiesData);

		return retryWithBackoff(
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

						const response = await retryWithBackoff(async () => {
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

						// Preparar dados para API core após processar batchUrls
						const processedUrls = await Promise.all(
							batchUrls.map(async (url) => {
								return {
									company_url: url.replace(/\/$/, ''),
									company_name: (affinityMetadata[url]?.[0]?.Name?.[0] || url).replace(/\/$/, '')
								};
							})
						);

						payloadForCore.companies = processedUrls;

						// Primeiro obtemos os dados do batch endpoint
						const allData = await this.callBatchEndpoint(payloadForCore);

						// Só depois processamos os URLs com os dados obtidos
						const chunkSize = 20; // Processar 20 por vez
						for (let j = 0; j < batchUrls.length; j += chunkSize) {
							const chunk = batchUrls.slice(j, j + chunkSize);

							await Promise.all(
								chunk.map(async (url) => {
									try {
										const companyData = await this.processCompanyData(
											url.replace(/\/$/, ''),
											affinityMetadata,
											allData
										);

										console.log(`Adding to CSV for ${url}:`, {
											lastEmail: companyData['Last Email Date'],
											lastMeeting: companyData['Last Meeting Date']
										});

										synchronized(() => {
											listOfReturns.push(companyData);
										});
									} catch (error) {
										console.error(`Error processing ${url}:`, error);
										listOfReturns.push({
											ID: `${this.generateRandomId()}-${this.generateRandomId()}`,
											'Company Name': url,
											'Company Website': url,
											Error: error.message,
											'Last Email Date': 'Error',
											'Last Meeting Date': 'Error',
											'Year Founded': 'Error'
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

	async processCompanyData(url, affinityMetadata, allData) {
		try {
			const companyName = (
				affinityMetadata[url] && affinityMetadata[url].length > 0 && affinityMetadata[url][0]['Name']
					? affinityMetadata[url][0]['Name'][0]
					: url
			).replace(/\/$/, '');

			let companyInfo = {
				dateFunded: 'N/A',
				companyLinkedin: 'N/A',
				headcount: 'N/A',
				description: 'N/A',
				location: 'N/A',
				founder: 'N/A',
				totalFunding: 'N/A',
				lastFunding: 'N/A',
				fundingDate: 'N/A',
				employeeGrowth: 'N/A',
				affinityId: 'N/A',
				lastMeeting: 'N/A',
				lastEmail: 'N/A',
				sfAccount: 'N/A',
				sfStringData: 'N/A'
			};

			let affinityData = [];
			try {
				console.log(`Searching Affinity for URL: ${url}`);

				affinityData = await this.searchOrganizations(
					url,
					true,
					true,
					'2001-01-01T00:00:00',
					'2034-01-12T23:59:59'
				);

				console.log(`Affinity search completed for ${url}, found ${affinityData.length} results`);
			} catch (error) {
				console.error(`Error searching Affinity for ${url}:`, error);
			}

			// Process Salesforce data
			if (allData?.salesforce?.websites && url in allData.salesforce.websites) {
				const sfWebsites = allData.salesforce.websites[url] || [];
				if (sfWebsites.length > 0) {
					const sfUrl = sfWebsites[0].attributes?.url || '';
					companyInfo.sfAccount = `https://bvp.lightning.force.com/lightning/r/Account${sfUrl.substring(
						sfUrl.lastIndexOf('/')
					)}/view`;
					companyInfo.sfStringData = String(sfWebsites[0]?.Owner?.Name || 'N/A');
				}
			}

			if (allData?.salesforce?.names && companyName in allData.salesforce.names) {
				const sfNames = allData.salesforce.names[companyName] || [];
				if (sfNames.length > 0) {
					const sfUrl = sfNames[0].attributes?.url || '';
					companyInfo.sfAccount = `https://bvp.lightning.force.com/lightning/r/Account${sfUrl.substring(
						sfUrl.lastIndexOf('/')
					)}/view`;
					companyInfo.sfStringData = String(sfNames[0]?.Owner?.Name || 'N/A');
				}
			}

			// Find specter data
			const findSpecterData = (allData, companyName) =>
				(allData.specter || []).filter((specter) => {
					const specterCompanyNames = specter.Company_Name || [''];
					const specterDomains = specter.Domain || [''];

					return specterCompanyNames[0] === companyName || specterDomains[0] === url;
				});

			const specterData = findSpecterData(allData, companyName);

			if (specterData.length > 0) {
				Object.assign(companyInfo, {
					dateFunded: specterData[0].Founded_Date?.[0] || 'N/A',
					companyLinkedin: specterData[0]['LinkedIn_-_URL']?.[0] || 'N/A',
					headcount: specterData[0].Employee_Count?.[0] || 'N/A',
					description: specterData[0].Description?.[0] || 'N/A',
					location: specterData[0].HQ_Region?.[0] || 'N/A',
					founder: specterData[0].Founders?.[0] || 'N/A',
					employeeGrowth: specterData[0]['Employees_-_6_Months_Growth']?.[0]?.toString() || '0',
					totalFunding: specterData[0]['Total_Funding_Amount__in_USD_']?.[0] || 'N/A',
					lastFunding: specterData[0]['Last_Funding_Amount__in_USD_']?.[0] || 'N/A',
					fundingDate: specterData[0]['Last_Funding_Date']?.[0] || 'N/A'
				});
			}

			if ((affinityMetadata[url] || []).length > 0) {
				const metadata = affinityMetadata[url][0];
				companyInfo = this.extractAffinityData(metadata, companyInfo);
			}

			if (companyInfo.lastEmail === 'N/A' || companyInfo.lastEmail === '' || companyInfo.lastEmail === null) {
				let specterFound = await querySolrByDomain(url);

				const fields = {
					Last_Email: (value) => {
						companyInfo.lastEmail = value;
					},
					Year_Founded: (value) => {
						companyInfo.dateFunded = value;
					},
					Number_of_Employees: (value) => {
						companyInfo.headcount = value;
					},
					Employees__Growth_YoY____: (value) => {
						companyInfo.employeeGrowth = value;
					},
					LinkedIn_Profile__Founders_CEOs_: (value) => {
						companyInfo.founder = value;
					},
					LinkedIn_URL: (value) => {
						companyInfo.companyLinkedin = value;
					},
					Total_Funding_Amount__USD_: (value) => {
						companyInfo.totalFunding = value;
					},
					Last_Funding_Date: (value) => {
						companyInfo.fundingDate = value;
					},
					Last_Funding_Amount__USD_: (value) => {
						companyInfo.lastFunding = value;
					},
					Location__Country_: (value) => {
						companyInfo.location = value;
					}
				};

				this.extractMultipleFields(specterFound, fields);
			}

			if (affinityData && affinityData.length > 0) {
				console.log('Using Affinity data for', url, {
					lastEmail: affinityData[0].interaction_dates?.last_email_date,
					lastMeeting: affinityData[0].interaction_dates?.last_event_date,
					companyId: affinityData[0].id
				});

				if (affinityData[0].interaction_dates?.last_email_date) {
					companyInfo.lastEmail = affinityData[0].interaction_dates.last_email_date;
				}

				if (affinityData[0].interaction_dates?.last_event_date) {
					companyInfo.lastMeeting = affinityData[0].interaction_dates.last_event_date;
				}

				companyInfo.affinityId = affinityData[0].id;
			}

			if (url.includes('minion')) {
				console.log('companyInfo', companyInfo);
			}

			if (companyInfo.sfAccount === 'N/A') {
				try {
					const { sfId, source } = await salesforceApi.salesforceIdFinal(companyName, url);

					if (sfId) {
						const ownerNameData = await salesforceApi.salesforceOwnername(sfId);

						if (ownerNameData) {
							companyInfo.sfAccount = ownerNameData.salesforce_url || 'N/A';

							companyInfo.sfStringData = ownerNameData.ownerName || 'N/A';

							if (
								companyInfo.lastEmail === 'N/A' ||
								companyInfo.lastEmail === '' ||
								companyInfo.lastEmail === null
							) {
								companyInfo.lastEmail = ownerNameData.last_email_date || 'N/A';
							}

							if (
								(companyInfo.lastMeeting === 'N/A' ||
									companyInfo.lastMeeting === '' ||
									companyInfo.lastMeeting === null) &&
								ownerNameData.last_activity
							) {
								companyInfo.lastMeeting = ownerNameData.last_activity;
							}
						}
					}
				} catch (error) {
					console.error(`Error fetching additional Salesforce data for ${companyName}: ${error.message}`);
				}
			}

			const finalValues = {
				lastEmail: companyInfo.lastEmail || 'N/A',
				lastMeeting: companyInfo.lastMeeting || 'N/A',
				sfAccount: companyInfo.sfAccount || 'N/A',
				sfStringData: companyInfo.sfStringData || 'N/A'
			};

			console.log(`FINAL VALUES FOR CSV ${url}:`, finalValues);

			return {
				ID: `${this.generateRandomId()}-${this.generateRandomId()}`,
				date_added: '',
				'Company Name': companyName,
				'Company Website': url.replace(/\/$/, ''),
				'Last Email Date': finalValues.lastEmail,
				'Last Meeting Date': finalValues.lastMeeting,
				'Link to Salesforce Entry': finalValues.sfAccount,
				'Salesforce Return String': finalValues.sfStringData,
				'Link to Affinity Entry':
					companyInfo.affinityId !== 'N/A'
						? `https://bvp.affinity.co/companies/${companyInfo.affinityId}`
						: companyInfo.affinityId,
				'Year Founded': companyInfo.dateFunded || 'N/A',
				'Company Linkedin': companyInfo.companyLinkedin || 'N/A',
				'Number of Employees': companyInfo.headcount || 'N/A',
				Description: companyInfo.description || 'N/A',
				Country: companyInfo.location || 'N/A',
				"Founders, CEO's Linkedin": companyInfo.founder || 'N/A',
				'Total Funding': companyInfo.totalFunding || 'N/A',
				'Last Funding': companyInfo.lastFunding || 'N/A',
				'Last Funding Date': companyInfo.fundingDate || 'N/A',
				'Employee Growth Rate': companyInfo.employeeGrowth || 'N/A'
			};
		} catch (error) {
			console.error(`Error processing company data for ${url}:`, error);
			throw error;
		}
	}

	cleanAndParseUrl(url) {
		let parsedUrl = url.replace(/\/$/, '');

		parsedUrl = parsedUrl.replace(/https?:\/\//, '').replace('www.', '');
		parsedUrl = parsedUrl.replace(/[\[\]'"]/g, '');

		try {
			const urlObj = new URL(`//${parsedUrl}`);
			let parsedDomain = urlObj.hostname;
			if (parsedDomain.startsWith('ftp.')) {
				parsedDomain = `${urlObj.protocol}//${parsedDomain}`;
			}
			return parsedDomain.toLowerCase();
		} catch (e) {
			console.error(`Invalid URL: ${parsedUrl}`, e);
			return parsedUrl.toLowerCase();
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

	extractAffinityData(metadata, dataObj) {
		try {
			if (dataObj.totalFunding === 'N/A' && 'Total_Funding_Amount__USD_' in metadata) {
				dataObj.totalFunding = metadata['Total_Funding_Amount__USD_'][0];
			}

			if (
				dataObj.lastMeeting === 'N/A' &&
				metadata &&
				'Last_Meeting' in metadata &&
				metadata['Last_Meeting'] &&
				metadata['Last_Meeting'].length > 0
			) {
				dataObj.lastMeeting = metadata['Last_Meeting'][0];
			}

			if (
				dataObj.lastEmail === 'N/A' &&
				metadata &&
				'Last_Email' in metadata &&
				metadata['Last_Email'] &&
				metadata['Last_Email'].length > 0
			) {
				dataObj.lastEmail = metadata['Last_Email'][0];
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

			if (dataObj.dateFunded === 'N/A' && 'Year_Founded' in metadata) {
				dataObj.dateFunded = metadata['Year_Founded'][0];
			}
			return dataObj;
		} catch (error) {
			console.error(`Error extracting Affinity data for ${metadata}:`, error);
		}
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
