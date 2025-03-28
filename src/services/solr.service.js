const axios = require('axios');
const { retryWithBackoff } = require('../utils');

const url = 'http://52.15.85.181:8983/solr/companies_specter_ID/select';
class SolrService {
	async querySolrByDomain(domain) {
		console.log('Re-check SOLR', domain);

		const queryParams = {
			'q.op': 'OR',
			q: `Website:"${domain}"`,
			sort: '_version_ DESC'
		};

		return retryWithBackoff(async () => {
			const response = await axios.get(url, {
				params: queryParams,
				timeout: 5000
			});
			return response.data;
		});
	}
}

module.exports = new SolrService();
