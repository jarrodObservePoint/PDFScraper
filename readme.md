# Getting Started

## Description

This tool enables you to gather metadata associated with PDFs accross your site leveraging the ObservePoint platform

## Pre-req

- [An ObservePoint license](https://www.observepoint.com/pricing/)
- Run an audit with the following code in an "Execute Javascript" on-page action to gather required data for the script

```js
let allPdfs = [].slice
  .call(document.querySelectorAll('[src*="pdf" i],[href*="pdf" i]'))
  .map((e) => e.href)
  .filter((e) => {
    return e;
  });
let logString = "PDF Links:";
let output = [],
  outputLength = logString.length + 2;

allPdfs.forEach((p, index) => {
  let tempOutputString = JSON.stringify(p);
  let tempOutputLength = tempOutputString.length;

  if (outputLength + tempOutputLength + 1 > 2000) {
    console.log(`${logString}${JSON.stringify(output)}`);
    output = [p];
    outputLength = logString.length + tempOutputLength + 2;
  } else {
    output.push(p);
    outputLength += tempOutputLength + 1;
  }

  if (index + 1 === allPdfs.length) {
    console.log(`${logString}${JSON.stringify(output)}`);
  }
});
```

- [Install NodeJS on your system](https://nodejs.org/en/learn/getting-started/how-to-install-nodejs)
- Install the required packages for the script via NPM running the follwoing in your terminal

```sh
npm install axios pdf-parse csv-writer csv-parse crypto
```

## How to Use

Download and save to your machine the most recent version of [the script](https://github.com/jarrodObservePoint/PDFScraper/blob/main/pdf_scraper.js).
Using the terminal on your machine, [navigate to the directory where you have saved the script](https://tutorials.codebar.io/command-line/introduction/tutorial.html#:~:text=The%20cd%20command%20allows%20you,command%20is%20cd%20your%2Ddirectory%20.&text=Now%20that%20we%20moved%20to,again%2C%20then%20cd%20into%20it.).
You can now run the script. An example of that execution from the terminal will look like the following:

```sh
node pdf_scraper.js [OberservePoint API Key] [Audit ID] [Run ID]
```

You can get your ObservePoint API Key by navigating to https://app.observepoint.com/my-profile.
For the Audit ID and Run ID, after running your audit instructed in the pre-requirements, navigate to that finished audit and use the URL to gather those IDs which have them in the following format:

```sh
https://app.observepoint.com/audit/[Audit ID]/run/[Run ID]/report/use-cases/overview
```
