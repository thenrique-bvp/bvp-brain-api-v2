const { URL } = require('url');
const jsforce = require('jsforce'); // Equivalente ao simple_salesforce em Python

class SalesforceService {
	constructor() {
		this.conn = new jsforce.Connection();
		this.initialized = false;
	}

	async initialize() {
		if (!this.initialized) {
			await this.conn.login('jscheller@bvp.com', 'Ploopers@123fJx7TNf0tRiFLlRCgAT968Vzz');
			this.initialized = true;
		}
	}

	async getAllCompaniesYouCreated(ownerId) {
		await this.initialize();

		const query = `SELECT Name, Id, Website FROM Account WHERE OwnerId = '${ownerId}'`;
		const results = await this.conn.query(query);
		const websites = results.records.filter((record) => record.Website).map((record) => record.Website);

		return websites;
	}

	async getWebsitesYouOwnNotCreated(bvpOwner) {
		await this.initialize();

		const query = `SELECT Website FROM Account WHERE BVP_Owners__c = '${bvpOwner}'`;
		const results = await this.conn.query(query);
		const websites = results.records.filter((record) => record.Website).map((record) => record.Website);

		return websites;
	}

	async getActiveUsers() {
		await this.initialize();

		const query = 'SELECT Id, Name, IsActive FROM User';
		const users = await this.conn.query(query);
		const activeUsers = users.records
			.filter((user) => user.IsActive)
			.map((user) => ({ Id: user.Id, Name: user.Name }));

		return activeUsers;
	}

	getUserIdByName(activeUsers, userName) {
		for (const user of activeUsers) {
			if (user.Name === userName) {
				return user.Id;
			}
		}
		return null; // Return null if the user is not found
	}

	// Método que corresponde ao SalesforceBatchAPI.company_website_exists
	async companyWebsiteExists(websites) {
		await this.initialize();

		try {
			// Prepare the list to store sanitized domains
			const sanitizedDomains = [];

			// Iterate over the list of websites to sanitize and prepare the domains
			for (const website of websites) {
				// Extract the domain from the website URL
				let domain;
				try {
					domain = new URL(website.startsWith('http') ? website : `http://${website}`).hostname;
				} catch (e) {
					domain = website;
				}

				// Sanitize the domain and remove 'www.'
				let sanitizedDomain = domain.replace(/'/g, "''").replace('www.', '');
				sanitizedDomain = sanitizedDomain.replace('http://', '').replace('https://', '');
				sanitizedDomain = sanitizedDomain.replace(':443', '');
				sanitizedDomains.push(sanitizedDomain);
			}

			// Prepare the SOQL query with OR conditions for all sanitized domains
			const queryConditions = sanitizedDomains.map((domain) => `Website LIKE '%${domain}%'`).join(' OR ');
			const soqlQuery = `SELECT Id, Name, Owner.Name, BVP_Owners__c, Last_Activity_Date__c, Last_Email_Received_Date__c FROM Account WHERE ${queryConditions} LIMIT 200`;

			// Execute the query
			const records = await this.conn.query(soqlQuery);

			// Prepare a dictionary to store results with domain as key
			const results = {};
			sanitizedDomains.forEach((domain) => {
				results[domain] = [];
			});

			// Iterate over the records and organize them by domain
			for (const record of records.records) {
				const website = record.Website || '';

				if (record.BVP_Owners__c) {
					if (!record.Owner) {
						// Initialize 'Owner' if not present
						record.Owner = {};
					}
					record.Owner.Name = record.BVP_Owners__c;
				}

				for (const domain of sanitizedDomains) {
					if (website.includes(domain)) {
						if (!results[domain]) {
							// Initialize domain list if not present
							results[domain] = [];
						}
						results[domain].push(record);
					}
				}
			}

			return results; // Return the dictionary with domains as keys
		} catch (error) {
			console.error(`An error occurred: ${error}`);
			return null;
		}
	}

	escapeSoqlString(s) {
		return s.replace(/'/g, '');
	}

	async companyNameExists(names) {
		await this.initialize();

		try {
			if (names.length > 0) {
				// Sanitize the names and prepare the SOQL query
				const sanitizedNames = names.map((name) => name.replace(/'/g, "''"));
				const queryConditions = sanitizedNames
					.map((name) => `Name = '${this.escapeSoqlString(name)}'`)
					.join(' OR ');
				const soqlQuery = `SELECT Id, Name, Owner.Name, BVP_Owners__c, Last_Activity_Date__c, Last_Email_Received_Date__c FROM Account WHERE ${queryConditions} LIMIT 200`;

				// Execute the query
				const records = await this.conn.query(soqlQuery);

				// Prepare a dictionary to store results with names as keys
				const results = {};
				sanitizedNames.forEach((name) => {
					results[name] = [];
				});

				// Iterate over the records and organize them by name
				for (const record of records.records) {
					const name = record.Name;
					if (record.BVP_Owners__c) {
						record.Owner.Name = record.BVP_Owners__c;
					}
					if (results[name]) {
						results[name].push(record);
					}
				}

				return results; // Return the dictionary with names as keys
			} else {
				return {};
			}
		} catch (error) {
			console.error(`An error occurred: ${error}`);
			return null;
		}
	}

	async salesforceIdFinal(name, website) {
		await this.initialize();

		try {
			// Attempt to add 'http://' prefix if missing to properly parse the URL
			if (!website.startsWith('http://') && !website.startsWith('https://')) {
				website = 'http://' + website;
			}

			// Extract the domain from the website URL
			let domain;
			try {
				domain = new URL(website).hostname;
			} catch (e) {
				domain = website;
			}

			// Prepare and sanitize the domain for the query
			const sanitizedDomain = domain.replace(/'/g, "''"); // Escape single quotes
			const domainNoWww = sanitizedDomain.replace('www.', '');
			console.log(`the sanitized domain is: ${domainNoWww}`);

			// List of queries to execute sequentially
			const queries = [
				`SELECT Id, Name FROM Account WHERE Website = 'https://${domainNoWww}' LIMIT 1`,
				`SELECT Id, Name FROM Account WHERE Website = 'http://${domainNoWww}' LIMIT 1`,
				`SELECT Id, Name FROM Account WHERE Website = 'https://www.${domainNoWww}' LIMIT 1`,
				`SELECT Id, Name FROM Account WHERE Website LIKE '%${domainNoWww}%' LIMIT 1`
			];

			// Execute each query sequentially and return the account ID if a match is found
			for (const query of queries) {
				const records = await this.conn.query(query);
				if (records.totalSize > 0) {
					return { sfId: records.records[0].Id, source: 'website' }; // Return the account ID and source
				}
			}

			// Check for name match if website match failed
			const nameQuery = `SELECT Id, Name FROM Account WHERE Name = '${this.escapeSoqlString(name)}' LIMIT 1`;
			const nameRecords = await this.conn.query(nameQuery);

			if (nameRecords.totalSize > 0) {
				return { sfId: nameRecords.records[0].Id, source: 'name' };
			}

			return { sfId: null, source: null }; // Return null values if not found
		} catch (error) {
			console.error(`An error occurred: ${error}`);
			return { sfId: null, source: null };
		}
	}

	async salesforceOwnername(salesforceId) {
		await this.initialize();

		const objectApiName = 'Account'; // Ensure this is the correct API name for your object

		if (salesforceId) {
			try {
				const query = `SELECT Id, Name, Owner.Name, BVP_Owners__c, Last_Activity_Date__c, Last_Email_Received_Date__c FROM ${objectApiName} WHERE Id = '${salesforceId}'`;
				const result = await this.conn.query(query);

				if (result.records && result.records.length > 0) {
					const record = result.records[0];

					const ownerName = record.BVP_Owners__c || (record.Owner ? record.Owner.Name : 'Unknown Owner');
					const sfId = record.Id;
					const salesforceUrl = `https://bvp.lightning.force.com/lightning/r/Account/${sfId}/view`;

					const lastEmailDate = record.Last_Email_Received_Date__c || 'No email date found';
					const lastActivity = record.Last_Activity_Date__c || 'No activity date found';

					return {
						ownerName,
						salesforce_url: salesforceUrl,
						last_email_date: lastEmailDate,
						last_activity: lastActivity
					};
				} else {
					return 'Entry not found.';
				}
			} catch (error) {
				return `An error occurred: ${error.message}`;
			}
		} else {
			return 'No entry in Salesforce found.';
		}
	}

	async salesforceOwnernames(salesforceIds) {
		await this.initialize();

		const objectApiName = 'Account'; // Ensure this is the correct API name for your object

		if (salesforceIds && salesforceIds.length > 0) {
			try {
				// Construct the query with the IN clause
				const idsString = salesforceIds.map((id) => `'${id}'`).join(', ');
				const query = `SELECT Id, Owner.Name FROM ${objectApiName} WHERE Id IN (${idsString})`;
				const result = await this.conn.query(query);

				const results = [];
				for (const record of result.records) {
					const ownerName = record.Owner.Name;
					const sfId = record.Id;
					const salesforceUrl = `https://bvp.lightning.force.com/lightning/r/Account/${sfId}/view`;

					results.push({
						salesforceId: record.Id,
						ownerName,
						salesforce_url: salesforceUrl
					});
				}

				// Check for any IDs not found in the result
				const foundIds = new Set(result.records.map((record) => record.Id));
				const notFoundIds = salesforceIds.filter((id) => !foundIds.has(id));

				for (const notFoundId of notFoundIds) {
					results.push({
						salesforceId: notFoundId,
						error: 'Entry not found.'
					});
				}

				return results;
			} catch (error) {
				return `An error occurred: ${error.message}`;
			}
		} else {
			return 'No entries in Salesforce found.';
		}
	}
}

const salesforceApi = new SalesforceService();

module.exports = { salesforceApi };
