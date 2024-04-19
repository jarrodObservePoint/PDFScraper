const axios = require('axios');
const pdf = require('pdf-parse');
const createCsvWriter = require('csv-writer').createObjectCsvWriter;

const apiKey = 'api_key MTB1Y21hcDYwa2hscDNlaGh1bmhmcDBxMXAzNW1xNnU1ZnVvdWJvaDd2ODM3ODk4aHM2am5ja2g4bjAmNzY0MCYxNTIwNDU3MDk1NzEx'; // Update with your Observepoint API key
const results = [];

async function fetchDataFromObservepoint() {
    try {
        const auditId = 662711; // Update with your Observepoint audit ID
        const runId = 4383055; // Update with your Observepoint run ID

        const response = await axios.post(
            `https://api.observepoint.com/v3/web-audits/${auditId}/runs/${runId}/exports/browser_logs_page_logs?allData=true`,
            {},
            {
                headers: {
                    'Authorization': `Bearer ${apiKey}`,
                    'Content-Type': 'application/json'
                }
            }
        );

        const exportId = response.data.exportId;

        const exportStatusResponse = await axios.get(
            'https://api.observepoint.com/v3/exports?page=0&size=100&sortBy=date_exported&sortDesc=true',
            {
                headers: {
                    'Authorization': `Bearer ${apiKey}`
                }
            }
        );

        let exportStatus = exportStatusResponse.data.exports.find(e => e.exportId === exportId).exportStatus;

        while (exportStatus !== 'completed') {
            await new Promise(resolve => setTimeout(resolve, 1000));

            const exportStatusResponse = await axios.get(
                'https://api.observepoint.com/v3/exports?page=0&size=100&sortBy=date_exported&sortDesc=true',
                {
                    headers: {
                        'Authorization': `Bearer ${apiKey}`
                    }
                }
            );

            exportStatus = exportStatusResponse.data.exports.find(e => e.exportId === exportId).exportStatus;
        }

        const exportDataResponse = await axios.get(
            `https://api.observepoint.com/v3/exports/${exportId}/download`,
            {
                headers: {
                    'Authorization': `Bearer ${apiKey}`
                }
            }
        );

        const csvData = exportDataResponse.data;
        const urls = parseUrlsFromCsv(csvData); // Function to parse URLs from CSV data

        await checkFillableForms(urls); // Call the function to check fillable forms with the obtained URLs
    } catch (error) {
        console.error('Error fetching data from Observepoint:', error);
    }
}