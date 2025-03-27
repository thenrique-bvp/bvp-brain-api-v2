const express = require('express');
const cors = require('cors');
const routes = require('./routes/routes');
const swaggerUi = require('swagger-ui-express');
const YAML = require('yamljs');
const swaggerDocument = YAML.load('swagger.yaml');

const app = express();

// Swagger documentation
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerDocument));

// Middlewares
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(cors());

app.use('/health', (req, res) => {
	res.status(200).json({
		status: 'success',
		message: 'API is running'
	});
});

console.log('API Routes being mounted:');
routes.stack.forEach((route) => {
	if (route.route) {
		const path = route.route.path;
		const methods = Object.keys(route.route.methods).join(', ').toUpperCase();
		console.log(`${methods} /api/v2${path}`);
	}
});

app.use('/api/v2', routes);

app.use((err, req, res, next) => {
	console.error(err.stack);
	res.status(500).json({
		status: 'error',
		message: 'Internal Server Error'
	});
});

module.exports = app;
