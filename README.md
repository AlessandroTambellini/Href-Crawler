# Href Crawler
Crawl a page, collect all the `href` of `<a>` tags and recursively crawl the page pointed by each one of them.  
When a page is not reachable, a log is gonna be outputted telling in which page the `href` is located and to what unreachable page is pointing to.

## Installation
Only [Node.js](https://nodejs.org/en) is required.

## Run
```
node crawler.js <url>
```
Where `<url>` is the url of the page you want to crawl. E.g. http://example.com

Alternatively, to view all the logs:
```
NODE_DEBUG=log node crawler.js <url>
```
