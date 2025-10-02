# Href Crawler
Href Crawler checks all links (hrefs) on a website, starting from a specified URL.

## Installation
Node.js is required.

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
    - Extracts all anchor tags (`<a>`) with their **href** attribute
    - Categorizes each link as either "internal" (same hostname) or "external" (different hostname). It skips JavaScript pseudo-links, page-internal links, anchors (#), etc.

3) **Link checking**:
    - For internal links: It recursively visits each **unvisited** page, continuing the crawling process
    - For external links: It performs a HEAD request to verify if the link is valid without downloading content

## Note
Href Crawler doesn't handle all types of redirection to other locations and it doesn't cover all possible responses.  
Also, the response back from a server might not be the expected one due to user-agent, encoding, proxy, etc. related stuff. This to say that sometimes you may get a warning or an error for pages that from the browser are perfectly loadable and therefore this is more of a tool for personal usage (Indeed I use it for my website).  
A reliable alternative to this toy is [Link Checker](https://validator.w3.org/checklink).
