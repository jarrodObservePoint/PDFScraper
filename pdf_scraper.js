const axios = require("axios");
const pdf = require("pdf-parse");
const crypto = require("crypto");
const createCsvWriter = require("csv-writer").createObjectCsvWriter;
const { parse } = require("csv-parse/sync");
const fs = require("fs");
const path = require("path");

const args = process.argv.slice(2);
if (args.length < 3) {
  console.error(
    "Please provide opApiKey, opAuditId, and opRunId as command-line arguments"
  );
  process.exit(1);
}

const opApiKey = args[0];
const opAuditId = args[1];
const opRunId = args[2];
let requestsPerSecond = 4;

const requestsPerSecondArg = args.find((arg) =>
  arg.startsWith("--requestsPerSecond=")
);
if (requestsPerSecondArg) {
  const value = parseInt(requestsPerSecondArg.split("=")[1]);
  if (!isNaN(value) && value > 0) {
    requestsPerSecond = value;
  }
}

const observePointExportUrl = `https://api.observepoint.com/v3/web-audits/${opAuditId}/runs/${opRunId}/exports/browser_logs_page_logs?allData=true`;
const observePointExportStatusUrl = `https://api.observepoint.com/v3/exports?page=0&size=100&sortBy=date_exported&sortDesc=true`;
const observePointHeaders = {
  "Content-Type": "application/json",
  Authorization: `api_key ${opApiKey}`,
};

const results = [];
let exportResults;

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchPdfUrls() {
  try {
    const exportResponse = await axios.post(observePointExportUrl, null, {
      headers: observePointHeaders,
    });
    const exportId = exportResponse.data.id;
    let exportStatus;
    do {
      await new Promise((resolve) => setTimeout(resolve, 5000));
      const exportStatusResponse = await axios.get(
        observePointExportStatusUrl,
        { headers: observePointHeaders }
      );
      exportStatus = exportStatusResponse.data.exports.filter(
        (e) => e.id === exportId
      )[0].exportStatus;
    } while (exportStatus !== "completed");
    const exportStatusResponse = await axios.get(observePointExportStatusUrl, {
      headers: observePointHeaders,
    });
    const downloadLink = exportStatusResponse.data.exports.filter(
      (e) => e.id === exportId
    )[0].exportDownloadLink;
    await processExport(downloadLink);
    const urls = [...new Set(await getPDFLinks())];
    return urls;
  } catch (error) {
    console.error("Error fetching PDF URLs from ObservePoint:", error.message);
    return [];
  }
}

async function processExport(link) {
  const response = await axios.get(link);
  const csvData = response.data;
  const csvParsed = parse(csvData, {
    columns: true,
    skip_empty_lines: true,
    skip_records_with_error: true,
  });

  exportResults = csvParsed;
}

async function getPDFLinks() {
  let pdfLinks = [];
  exportResults.forEach((p) => {
    if (p["LOG MESSAGE"].includes("PDF Links:")) {
      try {
        let pdfPages = JSON.parse(p["LOG MESSAGE"].split("PDF Links:")[1]);
        pdfLinks.push(...pdfPages);
      } catch (error) {}
    }
  });

  return pdfLinks;
}

async function checkFillableForms(pdfUrls) {
  console.log(`Number of PDFs to Scan: ${pdfUrls.length}`);
  try {
    const results = [];
    const tasks = pdfUrls.map(async (url, index) => {
      await delay((1000 / requestsPerSecond) * index);
      return fetchPdf(url, index);
    });

    const fetchedResults = await Promise.all(tasks);

    fetchedResults.forEach((result) => results.push(result));

    const hashCounts = results.reduce((acc, result) => {
      if (result.hash) {
        acc[result.hash] = (acc[result.hash] || 0) + 1;
      }
      return acc;
    }, {});

    results.forEach((result) => {
      result.duplicate = hashCounts[result.hash] > 1 ? "TRUE" : "FALSE";
    });

    const resultsDir = path.join(__dirname, "Results");
    if (!fs.existsSync(resultsDir)) {
      fs.mkdirSync(resultsDir);
    }

    const now = new Date();
    const fileName = `pdf_results_${now.getFullYear()}_${(now.getMonth() + 1)
      .toString()
      .padStart(2, "0")}_${now.getDate().toString().padStart(2, "0")}_${now
      .getHours()
      .toString()
      .padStart(2, "0")}_${now.getMinutes().toString().padStart(2, "0")}.csv`;
    const filePath = path.join(resultsDir, fileName);

    const csvWriter = createCsvWriter({
      path: filePath,
      header: [
        { id: "url", title: "PDF URL" },
        { id: "urlStatus", title: "PDF URL Status" },
        { id: "hash", title: "Unique Hash" },
        { id: "duplicate", title: "Duplicate PDF" },
        { id: "hasAcrobatForm", title: "Uses AcroForm" },
        { id: "hasXFAForm", title: "Uses XFA Form" },
        { id: "hasFillableForm", title: "Has Fillable Form" },
        { id: "pdfFormatVersion", title: "PDF Format Version" },
        { id: "pdfSize", title: "PDF Size (mb)" },
        { id: "creator", title: "Creator" },
        { id: "producer", title: "Producer" },
        { id: "totalPages", title: "Total PDF Pages" },
        { id: "renderedPages", title: "Rendered PDF Pages" },
        { id: "creationDate", title: "Creation Date" },
        { id: "modDate", title: "Last Modified Date" },
        { id: "daysAppart", title: "Days between Created and Modified" },
        { id: "daysSinceLastMod", title: "Days Since Last Modified" },
        { id: "observePointUrls", title: "URLs Where PDF Found" },
        { id: "note", title: "Note" },
      ],
    });

    await csvWriter.writeRecords(results);
    console.log(`Results saved to ${filePath}`);
  } catch (error) {
    console.error("Unhandled promise rejection:", error);
  }
}

async function fetchPdf(url, index) {
  try {
    console.log(`Fetching PDF ${index + 1}: ${url}`);
    const response = await axios.get(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_6) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36",
      },
      responseType: "arraybuffer",
    });
    const pdfBuffer = response.data;
    if (
      !response.headers["content-type"].includes("application/pdf") &&
      !response.headers["content-type"].includes("application/octet-stream")
    ) {
      throw Error(
        `Not a link to a pdf. File type is ${response.headers["content-type"]}`
      );
    }

    const hash = crypto.createHash("md5").update(pdfBuffer).digest("hex");

    const data = await pdf(pdfBuffer);
    const hasAcrobatForm = data.info.IsAcroFormPresent;
    const hasXFAForm = data.info.IsXFAPresent;
    const pdfFormatVersion = data.info.PDFFormatVersion;
    const pdfSize = Math.round((response.data.length / 1000000) * 100) / 100;
    const creator = data.info.Creator;
    const producer = data.info.Producer;
    const totalPages = data.numpages;
    const renderedPages = data.numrender;
    const creationDate = data.info.CreationDate
      ? dateParser(data.info.CreationDate)
      : "No Creation Date Available";
    const modDate = data.info.ModDate
      ? dateParser(data.info.ModDate)
      : "No Modification Date Available";
    const daysAppart = parseInt(
      (new Date(modDate) - new Date(creationDate)) / 1000 / 60 / 60 / 24
    );
    const daysSinceLastMod = parseInt(
      (new Date() - new Date(modDate)) / 1000 / 60 / 60 / 24
    );
    const pdfUrlsFromObservePoint = await getPdfUrlsFromObservePoint(url);

    return {
      url: url,
      urlStatus: response.status,
      hash: hash || "",
      hasAcrobatForm: hasAcrobatForm,
      hasXFAForm: hasXFAForm,
      hasFillableForm: hasXFAForm || hasAcrobatForm,
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
      observePointUrls: pdfUrlsFromObservePoint.join("\n"),
      note: "",
    };
  } catch (error) {
    console.error(`Error fetching PDF ${index + 1}: ${url}`, error.message);
    const pdfUrlsFromObservePoint = await getPdfUrlsFromObservePoint(url);
    return {
      url: url,
      urlStatus: error.response ? error.response.status : "Error",
      observePointUrls: pdfUrlsFromObservePoint.join("\n"),
      note: error.message,
    };
  }
}

function dateParser(date) {
  let dateCleaned =
    date.split(":").length > 1
      ? date.split(":")[1].substring(0, 8)
      : date.split(":")[0].substring(0, 8);
  let year = dateCleaned.substring(0, 4);
  let month = dateCleaned.substring(4, 6);
  let day = dateCleaned.substring(6, 8);

  return `${year}-${month}-${day}`;
}

async function getPdfUrlsFromObservePoint(pdfUrl) {
  try {
    let urls = exportResults
      .filter((r) => r["LOG MESSAGE"].includes(pdfUrl))
      .map((e) => {
        return e["INITIAL PAGE URL"];
      });
    return urls;
  } catch (error) {
    console.error(
      `Error fetching ObservePoint URLs for ${pdfUrl}:`,
      error.message
    );
    return [];
  }
}

async function main() {
  let pdfUrls = await fetchPdfUrls();
  await checkFillableForms(pdfUrls);
}

main();
