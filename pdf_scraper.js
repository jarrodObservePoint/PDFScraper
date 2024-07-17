const axios = require('axios');
const pdf = require('pdf-parse');
const createCsvWriter = require('csv-writer').createObjectCsvWriter;
const { parse } = require('csv-parse/sync');

const args = process.argv.slice(2);
if (args.length < 3) {
  console.error('Please provide opApiKey, opAuditId, and opRunId as command-line arguments');
  process.exit(1);
}

const opApiKey = args[0];
const opAuditId = args[1];
const opRunId = args[2];
const observePointExportUrl = `https://api.observepoint.com/v3/web-audits/${opAuditId}/runs/${opRunId}/exports/browser_logs_page_logs?allData=true`;
const observePointExportStatusUrl = `https://api.observepoint.com/v3/exports?page=0&size=100&sortBy=date_exported&sortDesc=true`;
const observePointHeaders = {
  'Content-Type': 'application/json',
  'Authorization': `api_key ${opApiKey}`
};

const results = [];

async function fetchPdfUrls() {
  try {
    const exportResponse = await axios.post(observePointExportUrl, null, { headers: observePointHeaders });
    const exportId = exportResponse.data.id;
    let exportStatus;
    do {
      await new Promise(resolve => setTimeout(resolve, 5000));
      const exportStatusResponse = await axios.get(observePointExportStatusUrl, { headers: observePointHeaders });
      exportStatus = exportStatusResponse.data.exports.filter(e => e.id === exportId)[0].exportStatus;
    } while (exportStatus !== 'completed');
    const exportStatusResponse = await axios.get(observePointExportStatusUrl, { headers: observePointHeaders });
    const downloadLink = exportStatusResponse.data.exports.filter(e => e.id === exportId)[0].exportDownloadLink;
    const urls = await getPDFLinks(downloadLink);
    return urls
  } catch (error) {
    console.error('Error fetching PDF URLs from ObservePoint:', error.message);
    return [];
  }
}

async function getPDFLinks(link) {
  const response = await axios.get(link);
  const csvData = response.data;
  const csvParsed = parse(csvData, {
    columns: true,
    skip_empty_lines: true
  });

  let pdfLinks = new Array();
  csvParsed.forEach(p => {
    if(p['LOG MESSAGE'].includes('PDF Links:')) {
      let pdfPages = JSON.parse(p['LOG MESSAGE'].split('PDF Links:')[1]);
      pdfLinks.push.apply(pdfLinks, pdfPages);
    }
  });
  
  return pdfLinks;
}

async function checkFillableForms(pdfUrls) {
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
          note: '',
        });
      } catch (error) {
        results.push({
          url: pdfUrls[i],
          urlStatus: error.response ? error.response.status : 'Error',
          note: error.message,
        });
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
}

async function main() {
  const pdfUrls = await fetchPdfUrls();
  await checkFillableForms(pdfUrls);
}

main();
