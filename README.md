# Href Crawler
Href Crawler checks all links (hrefs) on a website, starting from a specified URL.

## Installation
Node.js is required. Download Node.js: https://nodejs.org/en.

## Run
```
node crawler.js <url>
```
Where `<url>` is the url of the page you want to crawl. E.g. http://example.com

Alternatively, to view all the logs:
```
NODE_DEBUG=log node crawler.js <url>
```

## Description
Tool that checks all links (hrefs) on a website, starting from a specified URL.  
Breakdown of its functionality:

1) **Starting point**:  
It takes a URL as a command-line argument and begins crawling from there.

2) **Page crawling process**:
    - For each page, it fetches the HTML content
    - Extracts all anchor (`<a>`) tags with their **href** attributes
    - Categorizes links as either "internal" (same hostname) or "external" (different hostname). Skips JavaScript pseudo-links, page-internal links, anchors (#), etc.

3) **Link checking**:
    - For internal links: It recursively visits each **unvisited** page, continuing the crawling process
    - For external links: It performs a HEAD request to verify if the link is valid without downloading content

## Note
Href Crawler doesn't handle all types of redirection to other locations and it doesn't cover all possible responses.  
Also, the response back from a server might not be the expected one due to user-agent, encoding, proxy, etc. related stuff.  
All of this to say that sometimes you may get a warning or an error for pages that from the browser are perfectly loadable.  
A reliable alternative to this toy is [Link Checker](https://validator.w3.org/checklink).
