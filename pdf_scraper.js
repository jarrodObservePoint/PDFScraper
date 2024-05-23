const axios = require('axios');
const pdf = require('pdf-parse');
const createCsvWriter = require('csv-writer').createObjectCsvWriter;
const fs = require('fs');

const opApiKey = 'c3JmY2pmc283cTZ1bzdoMWd2MzdnOHNyazFrZm1rdW03Mmtrbjk0M3VhZjQ1bTM4anZoZHJnanE1MCYxNjU0OCYxNTUyNjY2MjE2NzI3';
const opAuditId = 1299831;
const opRunId = 4468246;
const csvFilePath = './pdfUrls.csv'; // Path to your CSV file that has the PDF URLs to be scanned
const csvDelimiter = ',';

const results = [];
const observePointUrl = `https://api.observepoint.com/v3/web-audits/${opAuditId}/runs/${opRunId}/reports/browser-logs/pages?page=0&size=50`;
const observePointHeaders = {
  'Content-Type': 'application/json',
  'Authorization': `api_key ${opApiKey}`
};

async function checkFillableForms() {
  let pdfUrls = await getUrls(csvFilePath, csvDelimiter);
  console.log(`Number of PDFs to Scan: ${pdfUrls.length}`);
  try {
    for (let i = 0; i < pdfUrls.length; i++) {
      console.log(`Working on PDF number ${i + 1} -- URL: ${pdfUrls[i]}`);
      try {
        const response = await axios.get(pdfUrls[i], {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_6) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36'
          },
          responseType: 'arraybuffer'
        });
        const pdfBuffer = response.data;
        if (response.headers['content-type'] !== 'application/pdf') {
          throw Error('Not a link to a pdf');
        }
        const data = await pdf(pdfBuffer);

        const hasAcrobatForm = data.info.IsAcroFormPresent;
        const hasXFAForm = data.info.IsXFAPresent;
        const pdfFormatVersion = data.info.PDFFormatVersion;
        const pdfSize = Math.round(response.data.length / 1000000 * 100) / 100;
        const creator = data.info.Creator;
        const producer = data.info.Producer;
        const totalPages = data.numpages;
        const renderedPages = data.numrender;
        const creationDate = dateParser(data.info.CreationDate);
        const modDate = dateParser(data.info.ModDate);
        const daysAppart = parseInt((new Date(modDate) - new Date(creationDate)) / 1000 / 60 / 60 / 24);
        const daysSinceLastMod = parseInt((new Date() - new Date(modDate)) / 1000 / 60 / 60 / 24);

        const pdfUrlsFromObservePoint = await getPdfUrlsFromObservePoint(pdfUrls[i]);

        results.push({
          url: pdfUrls[i],
          urlStatus: response.status,
          hasAcrobatForm: hasAcrobatForm,
          hasXFAForm: hasXFAForm,
          hasFillableForm: (hasXFAForm || hasAcrobatForm),
          pdfFormatVersion: pdfFormatVersion,
          pdfSize: pdfSize,
          creator: creator,
          producer: producer,
          totalPages: totalPages,
          renderedPages: renderedPages,
          creationDate: creationDate,
          modDate: modDate,
          daysAppart: daysAppart,
          daysSinceLastMod: daysSinceLastMod,
          observePointUrls: pdfUrlsFromObservePoint.join('\n'),
          note: '',
        });
      } catch (error) {
        if (error.message === 'Not a link to a pdf') {
          results.push({
            url: pdfUrls[i],
            urlStatus: 'n/a',
            note: error.message,
          });
        } else {
          results.push({
            url: pdfUrls[i],
            urlStatus: error.response ? error.response.status : 'Error',
            note: error.message,
          });
        }
      }
    }

    const csvWriter = createCsvWriter({
      path: 'pdf_results.csv',
      header: [
        { id: 'url', title: 'URL' },
        { id: 'urlStatus', title: 'URL Status' },
        { id: 'hasAcrobatForm', title: 'Uses AcroForm' },
        { id: 'hasXFAForm', title: 'Uses XFA Form' },
        { id: 'hasFillableForm', title: 'Has Fillable Form' },
        { id: 'pdfFormatVersion', title: 'PDF Format Version' },
        { id: 'pdfSize', title: 'PDF Size (mb)' },
        { id: 'creator', title: 'Creator' },
        { id: 'producer', title: 'Producer' },
        { id: 'totalPages', title: 'Total PDF Pages' },
        { id: 'renderedPages', title: 'Rendered PDF Pages' },
        { id: 'creationDate', title: 'Creation Date' },
        { id: 'modDate', title: 'Last Modified Date' },
        { id: 'daysAppart', title: 'Days between Created and Modified' },
        { id: 'daysSinceLastMod', title: 'Days Since Last Modified' },
        { id: 'observePointUrls', title: 'ObservePoint URLs' },
        { id: 'note', title: 'Note' },
      ],
    });

    await csvWriter.writeRecords(results);
    console.log('Results saved to pdf_results.csv');
  } catch (error) {
    console.error('Unhandled promise rejection:', error);
  }

  function dateParser(date) {
    let dateCleaned = (date.split(':').length > 1) ? date.split(':')[1].substring(0, 8) : date.split(':')[0].substring(0, 8);
    let year = dateCleaned.substring(0, 4);
    let month = dateCleaned.substring(4, 6);
    let day = dateCleaned.substring(6, 8);

    return `${year}-${month}-${day}`;
  }

  async function getUrls(csvFilePath, csvDelimiter) {
    try {
      const data = fs.readFileSync(csvFilePath, 'utf8');
      const lines = data.trim().split('\n');
      const urls = lines.slice(1).map(line => line.split(csvDelimiter)[0].trim());
      const pdfUrls = [...new Set(urls)];
      return pdfUrls;
    } catch (err) {
      console.error('Error reading CSV file:', err);
      return [];
    }
  }

  async function getPdfUrlsFromObservePoint(pdfUrl) {
    try {
      const response = await axios.post(observePointUrl, {
        messageText: {
          filterType: 'contains',
          filterValue: pdfUrl
        }
      }, { headers: observePointHeaders });
      const urls = response.data.pages.map(item => item.pageUrl);
      return urls;
    } catch (error) {
      console.error(`Error fetching ObservePoint URLs for ${pdfUrl}:`, error.message);
      return [];
    }
  }
}

checkFillableForms();